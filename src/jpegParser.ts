export class JpegFrameExtractor {
  private buffer = Buffer.alloc(0);

  /**
   * Feed bytes and return any complete JPEG frames found.
   * JPEG frames are delimited by SOI (FFD8) and EOI (FFD9).
   */
  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];

    while (true) {
      const soi = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi < 0) {
        if (this.buffer.length > 10_000_000) this.buffer = Buffer.alloc(0);
        break;
      }
      const eoi = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi < 0) {
        if (soi > 0) this.buffer = this.buffer.slice(soi);
        break;
      }

      const end = eoi + 2;
      const frame = this.buffer.slice(soi, end);
      frames.push(frame);
      this.buffer = this.buffer.slice(end);
    }

    return frames;
  }
}
