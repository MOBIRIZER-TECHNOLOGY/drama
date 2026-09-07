import * as ImagePicker from "expo-image-picker";
import { api } from "@/lib/api";
import { RequestError, unwrap } from "@/lib/errors";
import type { UserOut } from "@/lib/types";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function guessContentType(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType && ALLOWED.has(asset.mimeType)) return asset.mimeType;
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export type AvatarResult = { status: "cancelled" } | { status: "done"; user: UserOut };

/**
 * Pick a square image, presign an upload, PUT the bytes to storage, then point the profile at the public URL.
 * The system photo picker needs no media-library permission on either platform, so none is requested.
 */
export async function pickAndUploadAvatar(): Promise<AvatarResult> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
    selectionLimit: 1,
  });
  if (picked.canceled || picked.assets.length === 0) return { status: "cancelled" };
  const asset = picked.assets[0];
  const contentType = guessContentType(asset);
  const filename = asset.fileName ?? `avatar.${contentType.split("/")[1]}`;

  const presign = unwrap(await api.POST("/v1/auth/me/avatar/presign", { body: { filename, content_type: contentType } }));

  const blob = await (await fetch(asset.uri)).blob();
  const put = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!put.ok) throw new RequestError({ code: "upload_failed", message: "Could not upload the image. Try again." });

  const user = unwrap(await api.PATCH("/v1/auth/me", { body: { avatar_url: presign.public_url } }));
  return { status: "done", user };
}
