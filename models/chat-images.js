export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
// Sent when the user attaches images without typing text, since providers reject empty text.
export const IMAGE_PROMPT = "Analise a(s) imagem(ns) anexada(s).";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
// Every request resends the conversation, so the images kept in it are capped too.
export const MAX_CONVERSATION_IMAGE_BYTES = 20 * 1024 * 1024;

export function imageProblem(file) {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name}: formato não aceito. Use PNG, JPEG, WebP ou GIF.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: passa de ${formatSize(MAX_IMAGE_BYTES)}.`;
  return null;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10).replace(".", ",")} MB`;
}

// Reads a validated file into the shape the chat keeps in memory: base64 data without the data URL prefix.
export function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(",", 2)[1] || "";
      resolve({ name: file.name, mime: file.type, size: file.size, data });
    };
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
