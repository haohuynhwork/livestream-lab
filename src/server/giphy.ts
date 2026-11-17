import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { MediaPayload } from '~/lib/events'
import { authMiddleware } from '~/lib/middleware'
import { HttpError } from './access'

const API = 'https://api.giphy.com/v1'

type GiphyImage = { url: string; webp?: string; width: string; height: string }
type GiphyItem = { id: string; title: string; images: { fixed_height: GiphyImage; fixed_height_small?: GiphyImage } }

function apiKey() {
  const key = process.env.GIPHY_API_KEY
  if (!key) throw new HttpError(503, 'GIF search is not configured')
  return key
}

function toPayload(g: GiphyItem, img: GiphyImage = g.images.fixed_height): MediaPayload {
  return {
    provider: 'giphy',
    id: g.id,
    title: g.title,
    url: img.webp ?? img.url,
    width: Number(img.width),
    height: Number(img.height),
  }
}

async function giphy<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ api_key: apiKey(), rating: 'pg-13', ...params })
  const res = await fetch(`${API}${path}?${qs}`)
  if (res.status === 404) throw new HttpError(404, 'GIF not found')
  if (!res.ok) throw new HttpError(502, 'GIF provider error')
  return ((await res.json()) as { data: T }).data
}

/** Looks up a GIF or sticker by id; works for both since stickers share the /gifs id space. */
export async function fetchGiphy(id: string) {
  return toPayload(await giphy<GiphyItem>(`/gifs/${id}`, {}))
}

/** Search (or trending when `q` is empty) GIFs or stickers. */
export const searchGiphy = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      kind: z.enum(['gif', 'sticker']),
      q: z.string().trim().max(100).default(''),
      offset: z.number().int().min(0).max(4999).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const base = data.kind === 'gif' ? '/gifs' : '/stickers'
    const items = await giphy<GiphyItem[]>(data.q ? `${base}/search` : `${base}/trending`, {
      limit: '24',
      offset: String(data.offset),
      ...(data.q ? { q: data.q } : {}),
    })
    return items.map((g) => toPayload(g, g.images.fixed_height_small ?? g.images.fixed_height))
  })
