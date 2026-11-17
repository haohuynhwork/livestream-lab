import { useEffect, useRef, useState } from 'react'
import type { MediaPayload } from '~/lib/events'
import { searchGiphy } from '~/server/giphy'

const EMOJI = (
  '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 🤐 🤨 😐 😏 😒 🙄 😬 😌 😔 😴 ' +
  '🤒 🤯 🥳 😎 🤓 😕 😟 😮 😲 🥺 😢 😭 😱 😤 😡 🤬 💀 💩 🤡 👻 👽 🤖 😺 ' +
  '👍 👎 👏 🙌 🙏 🤝 💪 👀 👋 🤙 ✌️ 🤞 👌 🤌 ' +
  '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 💥 🔥 ✨ ⭐ 🎉 🎊 🎁 🏆 🎮 🎵 🎤 🎬 📸 💸 🚀 ⚡ 🌈 ☕ 🍕 🍿'
).split(' ')

type Tab = 'emoji' | 'gif' | 'sticker'

export function MediaPicker(props: {
  onEmoji: (e: string) => void
  onMedia: (kind: 'gif' | 'sticker', m: MediaPayload) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('emoji')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || t.closest?.('[data-picker-toggle]')) return
      props.onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])

  return (
    <div className="picker" ref={ref}>
      <div className="picker-tabs">
        {(['emoji', 'gif', 'sticker'] as const).map((t) => (
          <button key={t} className={tab === t ? 'small' : 'secondary small'} onClick={() => setTab(t)}>
            {t === 'emoji' ? 'Emoji' : t === 'gif' ? 'GIFs' : 'Stickers'}
          </button>
        ))}
      </div>
      {tab === 'emoji' ? (
        <div className="picker-emoji">
          {EMOJI.map((e) => (
            <button key={e} className="link" onClick={() => props.onEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
      ) : (
        <GiphySearch key={tab} kind={tab} onPick={(m) => props.onMedia(tab, m)} />
      )}
    </div>
  )
}

function GiphySearch({ kind, onPick }: { kind: 'gif' | 'sticker'; onPick: (m: MediaPayload) => void }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<MediaPayload[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await searchGiphy({ data: { kind, q } })
        if (!cancelled) setItems(res)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [kind, q])

  return (
    <>
      <input autoFocus value={q} placeholder={`Search ${kind === 'gif' ? 'GIFs' : 'stickers'}`} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error small">{error}</p>}
      <div className="picker-grid">
        {items.map((m) => (
          <button key={m.id} className="link" title={m.title} onClick={() => onPick(m)}>
            <img src={m.url} alt={m.title} loading="lazy" />
          </button>
        ))}
        {!loading && !error && items.length === 0 && <p className="muted small">No results</p>}
      </div>
      <p className="muted small picker-credit">Powered by GIPHY</p>
    </>
  )
}
