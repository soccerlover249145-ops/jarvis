// JarvisEars: always-on listening for Jarvis, with Apple's speech recognizer.
//
// Prints one JSON object per line on stdout:
//   {"type":"state","state":"listening","onDevice":true}
//   {"type":"partial","text":"hey jar"}
//   {"type":"final","text":"hey jarvis what's on today"}
// Reads one word per line on stdin: pause, resume, quit.
//
// Speech stays on the Mac when the Mac supports on-device recognition (requiresOnDeviceRecognition).
// With --on-device-only it refuses to run at all when it cannot keep speech on the Mac.
//
// Apple's recognizer does not end a phrase by itself while audio keeps flowing, so a phrase is
// "final" once the words have not changed for a moment of silence. Then a fresh recognition task
// starts, which also keeps each task well under Apple's time limit.
//
// Build: see native/build.sh (swiftc, with Info.plist embedded so macOS can show the permission
// prompts with the reasons written there).

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

var localeId = "en-US"
var onDeviceOnly = false
var silence: TimeInterval = 1.1      // seconds of unchanged words that end a phrase
let maxTask: TimeInterval = 50       // start a fresh task at least this often

var argv = CommandLine.arguments.dropFirst().makeIterator()
while let a = argv.next() {
    switch a {
    case "--locale": if let v = argv.next() { localeId = v }
    case "--on-device-only": onDeviceOnly = true
    case "--silence": if let v = argv.next(), let d = Double(v) { silence = max(0.5, min(3, d)) }
    default: break
    }
}

final class Ears {
    let recognizer: SFSpeechRecognizer
    let engine = AVAudioEngine()
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var paused = false
    var lastText = ""
    var lastChange = Date()
    var taskStart = Date()
    var onDevice = false
    var generation = 0
    var tapInstalled = false

    init?(locale: String) {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: locale)) ?? SFSpeechRecognizer() else { return nil }
        recognizer = r
    }

    func authorize(_ done: @escaping (Bool, String) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                done(false, status == .denied ? "speech-denied" : status == .restricted ? "speech-restricted" : "speech-not-allowed")
                return
            }
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: done(true, "")
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { ok in done(ok, ok ? "" : "mic-denied") }
            default: done(false, "mic-denied")
            }
        }
    }

    func startAudio() throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        if format.sampleRate == 0 || format.channelCount == 0 { throw NSError(domain: "JarvisEars", code: 1, userInfo: [NSLocalizedDescriptionKey: "no-microphone"]) }
        if !tapInstalled {
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let self = self, !self.paused else { return }
                self.request?.append(buffer)
            }
            tapInstalled = true
        }
        engine.prepare()
        try engine.start()
    }

    func beginTask() {
        generation += 1
        let gen = generation
        task?.cancel()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true
            onDevice = true
        } else {
            onDevice = false
        }
        if #available(macOS 13.0, *) { req.addsPunctuation = false }
        request = req
        lastText = ""
        lastChange = Date()
        taskStart = Date()
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard gen == self.generation else { return }
                if let r = result {
                    let text = r.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    if r.isFinal {
                        if !text.isEmpty { emit(["type": "final", "text": text]) }
                        self.beginTask()
                        return
                    }
                    if text != self.lastText {
                        self.lastText = text
                        self.lastChange = Date()
                        if !text.isEmpty { emit(["type": "partial", "text": text]) }
                    }
                }
                if error != nil {
                    // "no speech" and similar end a task; just start another after a breath
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        if gen == self.generation { self.beginTask() }
                    }
                }
            }
        }
    }

    /// called often: ends a phrase after silence, and replaces long-running tasks
    func tick() {
        guard !paused else { return }
        let now = Date()
        if !lastText.isEmpty && now.timeIntervalSince(lastChange) >= silence {
            emit(["type": "final", "text": lastText])
            beginTask()
        } else if lastText.isEmpty && now.timeIntervalSince(taskStart) >= maxTask {
            beginTask()
        } else if now.timeIntervalSince(taskStart) >= maxTask * 2 {
            // someone has talked non-stop for a long time: cut here so nothing is lost to the limit
            if !lastText.isEmpty { emit(["type": "final", "text": lastText]) }
            beginTask()
        }
    }

    func pause() {
        paused = true
        generation += 1
        task?.cancel(); task = nil; request = nil; lastText = ""
        emit(["type": "state", "state": "paused"])
    }

    func resume() {
        guard paused else { return }
        paused = false
        beginTask()
        emit(["type": "state", "state": "listening", "onDevice": onDevice])
    }
}

guard let ears = Ears(locale: localeId) else {
    emit(["type": "state", "state": "off", "reason": "no-recognizer"])
    exit(2)
}

if onDeviceOnly && !ears.recognizer.supportsOnDeviceRecognition {
    emit(["type": "state", "state": "blocked", "reason": "no-on-device"])
    exit(3)
}

ears.authorize { ok, why in
    DispatchQueue.main.async {
        guard ok else {
            emit(["type": "state", "state": "blocked", "reason": why])
            exit(4)
        }
        do {
            try ears.startAudio()
        } catch {
            emit(["type": "state", "state": "blocked", "reason": "no-microphone"])
            exit(5)
        }
        ears.beginTask()
        emit(["type": "state", "state": "listening", "onDevice": ears.onDevice])
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in ears.tick() }
    }
}

// stdin: pause, resume, quit. Exits when the parent closes the pipe, so it never outlives Jarvis.
DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true) {
        let word = line.trimmingCharacters(in: .whitespaces).lowercased()
        DispatchQueue.main.async {
            switch word {
            case "pause": ears.pause()
            case "resume": ears.resume()
            case "quit": exit(0)
            default: break
            }
        }
    }
    exit(0)
}

RunLoop.main.run()
