export const OFFER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

const OFFER_IMAGE_EXTENSIONS_BY_MIME = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"]
};

export function validateOfferImageFile(file) {
  if (!file) return "";

  const mimeType = String(file.type || "").toLowerCase();
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() || "";
  if (!OFFER_IMAGE_EXTENSIONS_BY_MIME[mimeType]?.includes(extension)) {
    return "Разрешены только изображения JPG, PNG и WebP.";
  }
  if (!Number.isFinite(file.size) || file.size < 1) {
    return "Файл изображения пуст.";
  }
  if (file.size > OFFER_IMAGE_MAX_BYTES) {
    return "Изображение должно быть не больше 25 МБ.";
  }
  return "";
}

export function getOfferPreviewImage(localPreviewUrl, persistedImageUrl, fallback) {
  return localPreviewUrl || persistedImageUrl || fallback;
}
