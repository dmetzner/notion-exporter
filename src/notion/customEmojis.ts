import type { createAssetCollector } from "../export/assets.js";
import type { Logger } from "../logger.js";
import { type NotionBlock, walkBlocks } from "./blocks.js";

/** Minimal "raw page" shape this helper consumes. Kept structurally loose so
 *  it accepts whatever the calling command already has on hand (export's
 *  `ExportedPage`, rerender/repair's loaded `RawPage`). */
export interface RawPageLike {
  /** Notion page payload; only `properties` is read. Typed as unknown so
   *  callers don't have to widen the page shape they already have. */
  page?: unknown;
  blocks?: NotionBlock[];
}

type AssetCollector = ReturnType<typeof createAssetCollector>;

interface CustomEmojiMention {
  type?: string;
  custom_emoji?: { name?: string; url?: string; local_path?: string };
}

/**
 * Walk every page's rich_text (and properties) for `custom_emoji` mentions.
 * Downloads any missing icons (URLs are unsigned public.notion-static.com,
 * so no refresh callback is needed) and returns a `name → local_path` map.
 *
 * The map is what `enrichTitle` (`src/export/pipeline.ts`) and the
 * sidebar-title patch consume to swap `:slug:` text for `<img>` tags.
 *
 * Safe to call with a partial set of pages — the resulting map is additive,
 * so commands that fetch pages over time can pass a stable Map reference
 * across calls and accumulate.
 */
export async function fetchCustomEmojis(
  rawPages: Iterable<RawPageLike>,
  assets: AssetCollector,
  log: Logger,
  customEmojiByName: Map<string, string> = new Map<string, string>(),
): Promise<Map<string, string>> {
  const emojiMentions: Array<{
    url: string;
    payload: { local_path?: string; name?: string };
  }> = [];
  function collect(items: unknown): void {
    if (!Array.isArray(items)) return;
    for (const item of items as Array<{ mention?: unknown }>) {
      const m = item?.mention as CustomEmojiMention | undefined;
      if (m?.type === "custom_emoji" && m.custom_emoji?.url) {
        if (!m.custom_emoji.local_path) {
          emojiMentions.push({ url: m.custom_emoji.url, payload: m.custom_emoji });
        } else if (m.custom_emoji.name) {
          // Last-wins by name: if the same `:slug:` is rebound to a different
          // URL between pages, the final mapping depends on iteration order
          // and is non-deterministic across runs. The downstream consumer
          // (`enrichTitle`) keys by name only, so collapsing here is
          // intentional.
          customEmojiByName.set(m.custom_emoji.name, m.custom_emoji.local_path);
        }
      }
    }
  }
  for (const data of rawPages) {
    const props = (data.page as { properties?: Record<string, unknown> } | null)?.properties ?? {};
    for (const prop of Object.values(props)) {
      const p = prop as { rich_text?: unknown; title?: unknown };
      collect(p?.rich_text);
      collect(p?.title);
    }
    for (const b of walkBlocks(data.blocks ?? [])) {
      const inner = b[b.type] as { rich_text?: unknown } | undefined;
      collect(inner?.rich_text);
    }
  }
  if (emojiMentions.length > 0) {
    log.info({ count: emojiMentions.length }, "downloading missing custom emojis");
    await Promise.all(
      emojiMentions.map(async (m) => {
        try {
          const rec = await assets.collect(m.url, { hint: ".png" });
          m.payload.local_path = rec.localPath;
          // Last-wins by name across concurrent per-page workers: if the same
          // `:slug:` resolves to different URLs across pages, the surviving
          // entry depends on download completion order and is
          // non-deterministic. Acceptable.
          if (m.payload.name) customEmojiByName.set(m.payload.name, rec.localPath);
        } catch (err) {
          log.warn({ err: (err as Error).message }, "custom emoji download failed");
        }
      }),
    );
  }
  return customEmojiByName;
}
