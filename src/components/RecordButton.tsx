import { useEffect, useState } from 'react'
import { getActiveRecording, startRecording, stopRecording } from '~/server/recordings'

export function RecordButton({ target }: { target: { kind: 'stream' | 'call'; id: string } }) {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getActiveRecording({ data: target }).then((r) => setRecording(!!r))
  }, [target.kind, target.id])

  return (
    <span className="record">
      <button
        className={recording ? 'recording' : 'secondary'}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            if (recording) await stopRecording({ data: target })
            else await startRecording({ data: target })
            setRecording(!recording)
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {recording ? '■ Stop recording' : '● Record'}
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  )
}
