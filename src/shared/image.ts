// A raw image passed between modules (structure maps, generated pictures): row-major, 8 bits per channel.
import { encodePng } from './png.ts';

export interface Image { width: number; height: number; channels: 1 | 3; pixels: Uint8Array }

export const toPng = (img: Image): Uint8Array => encodePng(img.width, img.height, img.pixels, img.channels);
