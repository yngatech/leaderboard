/**
 * Refetches worker/fonts/*.woff2: the two site typefaces, cut down to the
 * characters a README card can contain.
 *
 *   node scripts/subset-fonts.ts
 *
 * A card is loaded through an <img>, where a remote font URL is not allowed to
 * load — a data URI is not a fetch, so it is. Google Fonts will subset a face
 * to an exact character set, which is what keeps the two to ~15 KB between
 * them instead of ~200 KB. The Worker imports them with Vite's `?inline`,
 * which does the base64 encoding at build time.
 *
 * Run this by hand when CHARACTERS changes, not on every build: a deploy
 * should never depend on fonts.googleapis.com being reachable.
 */
import { writeFile } from "node:fs/promises";

/** Google Fonts serves woff2 only to clients that claim to support it. */
const UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/**
 * Everything a card can print. The mono face carries the labels, the handle
 * and the display name, so it needs latin plus the punctuation GitHub allows
 * in a login and the ellipsis a clamped name ends in; the display face only
 * ever sets the two numbers.
 */
const FACES = [
  {
    file: "display.woff2",
    family: "Bricolage+Grotesque:opsz,wght@12..96,800",
    characters: "0123456789,+",
  },
  {
    file: "mono.woff2",
    family: "DM+Mono:wght@400",
    characters:
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,.-–—·…@#/:'’()+" +
      // Display names are free text: without latin-1 an accent falls back to a
      // system face mid-word, at a different advance to everything beside it.
      "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ",
  },
] as const;

async function subset(family: string, characters: string): Promise<Buffer> {
  const query = `family=${family}&text=${encodeURIComponent(characters)}`;
  const css = await fetch(`https://fonts.googleapis.com/css2?${query}`, {
    headers: { "User-Agent": UA },
  });
  if (!css.ok) throw new Error(`Google Fonts refused ${family} (${css.status})`);

  const url = /https:\/\/fonts\.gstatic\.com\/[^)]*/.exec(await css.text())?.[0];
  if (!url) throw new Error(`No woff2 in the Google Fonts response for ${family}`);

  const font = await fetch(url);
  if (!font.ok) throw new Error(`Could not fetch the subset for ${family} (${font.status})`);
  return Buffer.from(await font.arrayBuffer());
}

for (const face of FACES) {
  const body = await subset(face.family, face.characters);
  await writeFile(new URL(`../worker/fonts/${face.file}`, import.meta.url), body);
  const characters = [...new Set(face.characters)].length;
  console.log(`${face.file}: ${(body.byteLength / 1024).toFixed(1)} KB (${characters} characters)`);
}
