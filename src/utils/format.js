export const getPreviewText = (htmlContent, filesArray) => {
  const text = (htmlContent || "").replace(/<[^>]*>?/gm, "").trim();
  if (text) return text;

  if (filesArray && filesArray.length > 0) {
    const type = filesArray[0].type || "";
    if (type.startsWith("image/")) return "Sent an image";
    if (type.startsWith("video/")) return "Sent a video";
    if (type.startsWith("audio/")) return "Sent an audio file";
    if (type.includes("pdf")) return "Sent a PDF";
    return "Sent a file";
  }

  return "New message";
};
