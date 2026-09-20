// AudioProcessor.ts (AudioWorklet)
import { Envelope } from "@aura-music/core/audioEnvelope";

declare const sampleRate: number;

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: unknown): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;

class AudioProcessor extends AudioWorkletProcessor {
  private port2: MessagePort | null = null;
  private envelope = new Envelope(sampleRate);
  private beat = false;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === "BEAT") {
        if (this.beat === event.data.enabled) return;
        this.beat = event.data.enabled === true;
        this.envelope = new Envelope(sampleRate);
        return;
      }
      if (event.data.type !== "PORT") return;
      this.port2?.close();
      this.port2 = event.data.port;
      this.port2?.postMessage({ type: "SAMPLE_RATE", rate: sampleRate });
      this.port.postMessage({ type: "PORT_RECEIVED" });
    };
  }

  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const data = input[0];
    if (!data || data.length === 0) return true;

    if (this.port2) {
      const copy = new Float32Array(data);
      this.port2.postMessage({ type: "AUDIO_DATA", data: copy }, [copy.buffer]);
    }

    if (this.beat) {
      const envelope = this.envelope.push(data, input[1]);
      if (envelope) this.port.postMessage({ type: "LEVEL", ...envelope });
    }
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
