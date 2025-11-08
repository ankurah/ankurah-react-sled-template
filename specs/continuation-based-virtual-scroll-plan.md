# Continuation-Based Virtual Scroll Plan

## Acceptance Criteria

1. Messages presented in typical chat ordering with latest at bottom
2. Single ankurah livequery with reversible cursor/continuation:
   - **Live mode**: descending timestamp + limit, no cursor (always showing latest, auto-scroll to bottom)
   - **Backward view**: cursor below viewport items by margin (offscreen buffer for direction reversal), ORDER BY timestamp DESC, limit
   - **Forward view**: cursor above viewport items, ORDER BY timestamp ASC, limit
3. Query is inclusive so cursor/continuation entity is present in both old and new resultsets for smooth scrolling

## Core Issues in Current Implementation

### 1. Anchor Selection (viewport-relative vs list-relative)

**Problem**: stepBack is measured from list extremes (newest/oldest item), not viewport edges. After paging, first/last items are often far offscreen, so the anchor no longer corresponds to "stepBack outside the viewport edge."

**Fix**: Measure stepBack from viewport edges:

- **Backward** (load older): pick first item with `elTop ≥ viewportBottom + stepBack`
  - Fallback: first item with `elTop ≥ viewportBottom + oneMinRow`
  - If none: treat as boundary, stop backward loading
- **Forward** (load newer): pick last item with `elBottom ≤ viewportTop − stepBack`
  - Fallback: last item with `elBottom ≤ viewportTop − oneMinRow`
  - If none: treat as boundary, switch to live mode

**Why**: Guarantees anchor is always on opposite side of viewport with stable overlap, preventing wrong window fetches and jumpy deltas.

### 2. Stale DOM Node Across Selection Update

**Problem**: Code captures `el` before the query, then reuses the same element instance after changing selection to compute `yAfter`. If React remounts the row (common when sort order flips), the original `el` becomes detached, producing wrong deltas and visual jumps.

**Fix**:

- Store `anchorId` only (not the DOM node)
- Compute `yBefore` via bounding rect relative to container
- After `updateSelection` resolves, re-query DOM for `data-msg-id="${anchorId}"` to measure `yAfter`
- If anchor missing after update, skip delta adjustment

### 3. Mode/Order Flicker

**Problem**: `mode` is set to `forward`/`backward` before the new selection is applied. The `items` getter flips reversal behavior based on `mode`, but `MessageLiveQuery` still has the previous selection (and ordering). This temporarily re-renders the same array with opposite reversal, creating flicker and invalidating anchor positions.

**Fix**: Either:

- Flip `mode` only after `updateSelection` completes, OR
- Derive display reversal from `messages.currentSelection` (ASC vs DESC) instead of `mode`

**Key**: Don't change list ordering until the new ordering is actually in effect.

### 4. Threshold Coupling and Hysteresis

**Problem**: `minBufferSize` and `continuationStepBack` are both 0.75 viewport height. When equal, the anchor can be too close to the trigger threshold, causing the newly fetched window to still be within the trigger zone (thrash).

**Fix**:

- Express both as row counts using `minRowPx`: `minBufferRows ≈ 8–10`, `stepBackRows = minBufferRows - 1`
- Ensure `stepBack < minBuffer` by at least one min row
- After any load completes, suppress new loads until scroll moves beyond trigger by ≥ oneMinRow (hysteresis)

### 5. Exact-Fit Dead Zone

**Problem**: Without extra whitespace, at list boundaries you can land on a dataset that exactly fills the viewport with no scrollbar. User cannot scroll to cross trigger threshold → stuck.

**Fix**:

- On init/afterLayout, ensure computed `limit` satisfies: `limit * minRowPx ≥ viewportHeight + 2*minBufferPx + oneMinRow`
- If not, increase `limit` (or `querySize`) accordingly
- After each selection applies: if `scrollHeight <= clientHeight + 1px` and `resultCount === limit`, immediately fetch once toward the smaller gap side
- On `wheel` event, run gap check immediately to permit paging even when `scrollTop` doesn't change

### 6. In-Flight Preemption

**Problem**: Multiple loads can be in-flight across directions. If user reverses direction mid-load, the older load's scroll compensation can apply after the newer load, causing visual jump.

**Fix**:

- Add monotonically increasing `loadToken`
- Stamp each load with current token
- Only apply delta if token matches when selection resolves
- Allow direction reversal to preempt (don't serialize globally, just per-direction)

### 7. Live-Mode Exit Threshold

**Problem**: Auto-scroll to bottom continues too long while user is scrolling up. Switch to backward mode happens way too late (~75% of viewport).

**Fix**:

- If in live and user scrolls > ~100px above bottom, stop autoscroll
- Resume autoscroll only when explicitly returning to live or when forward paging hits end

## Implementation Tasks

### 1. Anchor Selection (viewport-based)

- Change `getContinuationAnchor` to measure from viewport edges:
  - Backward: `const targetPos = scrollTop + clientHeight + stepBack`
    - Find first item with `elTop >= targetPos`
    - Fallback: first item with `elTop >= scrollTop + clientHeight + oneMinRow`
  - Forward: `const targetPos = scrollTop - stepBack`
    - Find last item with `elBottom <= targetPos`
    - Fallback: last item with `elBottom <= scrollTop - oneMinRow`
- If no anchor found, return null (caller treats as boundary)

### 2. Delta Application

- In `loadMore`:
  - Store `anchorId = msg.id.to_base64()` only
  - Compute `yBefore` using `getBoundingClientRect()` relative to container rect
- After `updateSelection` resolves:
  - Re-query DOM: `container.querySelector(\`[data-msg-id="${anchorId}"]\`)`
  - If found, compute `yAfter`, apply delta
  - If missing, skip delta adjustment

### 3. Ordering/Mode

- Option A: Don't change `mode` until after `updateSelection` completes
- Option B: Compute display order from `messages.currentSelection` (check for ASC/DESC) instead of `mode`
- Ensure list reversal only happens once the new query order is active

### 4. Thresholds and Hysteresis

- In `getThresholds()`:
  ```
  const minBufferRows = 8; // or compute from minBufferSize
  const minBufferPx = Math.max(minBufferSize * windowPx, minBufferRows * minRowPx);
  const stepBackPx = minBufferPx - minRowPx;
  ```
- Add hysteresis: after load completes, require gap to move beyond trigger by ≥ oneMinRow before allowing next load

### 5. Exact-Fit Prevention

- On init/`afterLayout`:
  ```
  const requiredLimit = Math.ceil((viewportHeight + 2*minBufferPx + minRowPx) / minRowPx);
  if (computedLimit < requiredLimit) {
    // increase querySize or limit
  }
  ```
- After each selection applies:
  ```
  if (scrollHeight <= clientHeight + 1 && resultCount === limit) {
    // immediately fetch once toward smaller gap
  }
  ```
- On `wheel` event: run gap check immediately (don't wait for scroll event)

### 6. In-Flight Preemption

- Add `private loadToken = 0`
- At start of `loadMore`: `const token = ++this.loadToken`
- Before applying delta: `if (token !== this.loadToken) return;`

### 7. Live-Mode Exit

- Track distance from bottom in live mode
- If user scrolls > 100px above bottom, stop autoscroll (effectively backward mode behavior)
- Only resume autoscroll when explicitly switching to live or forward hits end

### 8. Event Handling

- Keep `wheel` handler for user-scroll detection
- Remove `touchstart` handler (trackpad uses wheel)
- On `wheel`, immediately run gap checks to permit paging even without scroll event

### 9. Cleanups

- Remove or wire `checkBuffers()` for proactive prefetch
- Drop unused `paused` flag

## Boundary Handling

- **Backward end-of-history**: `resultCount < limit` → set `hitBeginning = true`, stop backward loads
- **Forward near "now"**: `resultCount < limit` → switch to live mode
- **No anchor found**: treat as boundary (backward: stop; forward: switch to live)

## Key Invariants

- Anchor is always outside viewport on the opposite side from load direction
- `stepBack < minBuffer` by at least one min row
- Display order matches query order (no transient flips)
- Delta compensation uses fresh DOM measurements after selection applies
- LIMIT sized to guarantee offscreen buffer when more data exists
