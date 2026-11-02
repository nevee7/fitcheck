// Apple Vision foreground cutout helper for Fitcheck.
//
// Usage: cutout <input-image> <output-png>
//
// Generates a transparent PNG of the largest foreground object in the photo.
// Used by tools/digitize_thumbs.py to turn flat-lay photos into catalog-style
// wardrobe thumbnails. macOS 14+ (Apple Silicon or Intel).

import Foundation
import Vision
import AppKit
import CoreImage

guard CommandLine.arguments.count >= 3 else {
    fputs("usage: cutout <input> <output.png>\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let nsImage = NSImage(contentsOf: inputURL),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("could not load image\n", stderr)
    exit(1)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    fputs("vision error: \(error)\n", stderr)
    exit(1)
}

guard let observation = request.results?.first else {
    fputs("no foreground found\n", stderr)
    exit(1)
}

// Photos can contain more than one recognised object (the garment, a shadow
// on the floor, a hand). The garment is always the largest one.
var largest: (index: Int, area: Int)?
for instance in observation.allInstances {
    guard let mask = try? observation.generateMask(forInstances: IndexSet(integer: instance)) else {
        continue
    }
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }

    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
    guard let base = CVPixelBufferGetBaseAddress(mask) else { continue }

    var count = 0
    let ptr = base.assumingMemoryBound(to: Float.self)
    for y in 0..<height {
        let row = ptr + (y * bytesPerRow / MemoryLayout<Float>.size)
        for x in 0..<width where row[x] > 0.5 {
            count += 1
        }
    }
    if largest == nil || count > largest!.area {
        largest = (instance, count)
    }
}

guard let chosen = largest else {
    fputs("no usable foreground instance\n", stderr)
    exit(1)
}

do {
    let pixelBuffer = try observation.generateMaskedImage(
        ofInstances: IndexSet(integer: chosen.index),
        from: handler,
        croppedToInstancesExtent: true
    )
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
    let context = CIContext()
    guard let outCG = context.createCGImage(ciImage, from: ciImage.extent) else {
        fputs("could not create output\n", stderr)
        exit(1)
    }
    let rep = NSBitmapImageRep(cgImage: outCG)
    guard let data = rep.representation(using: .png, properties: [:]) else {
        fputs("could not encode png\n", stderr)
        exit(1)
    }
    try data.write(to: outputURL)
    print("ok \(outCG.width)x\(outCG.height)")
} catch {
    fputs("mask error: \(error)\n", stderr)
    exit(1)
}
