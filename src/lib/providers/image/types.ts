export type ImageRequest = {
  prompt: string;
  /** "16:9" | "1:1" | "4:3" | "9:16" */
  aspect?: string;
  model?: string;
};

export type ImageResult = {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  costUsd: number;
};

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export function aspectToSize(aspect = '16:9'): { w: number; h: number } {
  switch (aspect) {
    case '1:1':
      return { w: 1024, h: 1024 };
    case '4:3':
      return { w: 1408, h: 1024 };
    case '3:2':
      return { w: 1536, h: 1024 };
    case '9:16':
      return { w: 1024, h: 1536 };
    case '16:9':
    default:
      return { w: 1536, h: 864 };
  }
}
