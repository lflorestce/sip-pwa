# Qubit SVG Expression Set

Production-friendly SVG mascot expressions for TCE VoiceIQ's live AI assistant, Qubit.

## Files

- `qubit-listening.svg` — live call listening / audio capture state
- `qubit-thinking.svg` — analyzing / processing state
- `qubit-suggesting.svg` — recommendation / assist state
- `qubit-supporting.svg` — positive confirmation / agent support state
- `qubit-celebrating.svg` — success / completed action state
- `qubit-alerting.svg` — important insight / warning state

## Suggested Next.js placement

```txt
/public/qubit/
  qubit-listening.svg
  qubit-thinking.svg
  qubit-suggesting.svg
  qubit-supporting.svg
  qubit-celebrating.svg
  qubit-alerting.svg
```

## Example usage

```tsx
<img src="/qubit/qubit-listening.svg" alt="Qubit is listening" width={96} height={96} />
```

These SVGs are intentionally self-contained, editable, and do not depend on external fonts or assets.
