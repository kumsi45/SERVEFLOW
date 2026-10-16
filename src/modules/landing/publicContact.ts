export const WHATSAPP_URL = "https://wa.me/251990069892";

export const publicWhatsAppLink = (message: string) =>
  `${WHATSAPP_URL}?text=${encodeURIComponent(message)}`;

export const WHATSAPP_SUPPORT_URL = publicWhatsAppLink(
  "Hello KumsiTech, I have a question about ServeFlow.",
);
