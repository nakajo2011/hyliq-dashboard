import jsQR from "jsqr";

/**
 * Decode the first QR code found in an uploaded image file and extract an
 * Ethereum-style `0x…` address from it. Returns null if no QR code is found
 * or it contains no address.
 *
 * The QR payload may be a bare address or an EIP-681 URI
 * (`ethereum:0x…@chainId`); we just pull the first 0x + 40 hex match.
 */
export async function decodeQrAddress(file: File): Promise<string | null> {
  const text = await decodeQr(file);
  if (!text) return null;
  const m = /0x[0-9a-fA-F]{40}/.exec(text);
  return m ? m[0] : null;
}

async function decodeQr(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas が利用できません");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
    const result = jsQR(data, width, height);
    return result?.data ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}
