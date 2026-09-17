/**
 * The balance-series consumption caliber (`balanceDay.ts`): the day's first
 * queried balance minus the current one, plus the top-ups the series shows,
 * with the day rolled over on the LOCAL calendar day and persisted through the
 * storage seam. Every case here is a rule the mirrored `balanceinfo` program
 * states in its own `utils/balance.ts` + `Dashboard.tsx`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DeepSeekBalance } from '@rayadesu/dsh-llm-billing/types'
import {
  applyBalanceSample,
  balanceDaySpendOf,
  BALANCE_DAY_STORAGE_KEY,
  createBalanceDayTracker,
  decodeBalanceDayRecord,
  localDayKey,
  topUpFromGrowthCents,
  type BalanceDayRecord,
  type BalanceDayStorage,
} from '../src/client/balanceDay.ts'

/** One line's worth of balance snapshot; the API reports decimal STRINGS. */
function balanceOf(total: string, currency = 'CNY'): DeepSeekBalance {
  return { isAvailable: true, lines: [{ currency, total, granted: '0.00', toppedUp: total }] }
}

/** A fixed local instant inside one day; the suite never depends on the real clock. */
const DAY = new Date(2026, 8, 15, 10, 0, 0)
const SAME_DAY = new Date(2026, 8, 15, 18, 30, 0)
const NEXT_DAY = new Date(2026, 8, 16, 0, 5, 0)

/** An in-memory seam standing in for `localStorage`. */
function memoryStorage(seed?: string): BalanceDayStorage & { value: string | null } {
  return {
    value: seed ?? null,
    getItem(key: string) {
      return key === BALANCE_DAY_STORAGE_KEY ? this.value : null
    },
    setItem(key: string, value: string) {
      if (key === BALANCE_DAY_STORAGE_KEY) this.value = value
    },
  }
}

/** Fold a whole series in one call, the way repeated mounts do. */
function series(totals: string[], now: Date = DAY): BalanceDayRecord | null {
  let record: BalanceDayRecord | null = null
  for (const total of totals) record = applyBalanceSample(record, balanceOf(total), now)
  return record
}

describe('localDayKey', () => {
  it('keys the LOCAL calendar day, ignoring the time of day', () => {
    // The mirrored program keys on the local day (`toLocalDayKey`) and so does
    // this one: the host's Beijing day key would be the wrong day for a user
    // whose browser sits in another zone, and this figure is a display caliber.
    expect(localDayKey(new Date(2026, 8, 15, 0, 0, 0))).toBe('2026-09-15')
    expect(localDayKey(new Date(2026, 8, 15, 23, 59, 59))).toBe('2026-09-15')
    expect(localDayKey(new Date(2026, 0, 2, 12, 0, 0))).toBe('2026-01-02')
    expect(localDayKey(new Date(2026, 11, 31, 23, 30, 0))).toBe('2026-12-31')
  })
})

describe('topUpFromGrowthCents', () => {
  it('rounds an observed increase UP to the next ¥10 step', () => {
    // The provider only ever tops up in round tens, so a ¥9 rise (topped up ¥10,
    // spent ¥1) is a ¥10 top-up and a ¥23 rise is ¥30 — exactly the mirrored
    // program's `rechargeFromGrowth`.
    expect(topUpFromGrowthCents(900)).toBe(1_000)
    expect(topUpFromGrowthCents(2_300)).toBe(3_000)
    expect(topUpFromGrowthCents(100)).toBe(1_000)
    // An exact step stays where it is (ceil, not the next step up).
    expect(topUpFromGrowthCents(1_000)).toBe(1_000)
    expect(topUpFromGrowthCents(10_000)).toBe(10_000)
    expect(topUpFromGrowthCents(1_001)).toBe(2_000)
    // Zero and every DECREASE are consumption, never a top-up.
    expect(topUpFromGrowthCents(0)).toBe(0)
    expect(topUpFromGrowthCents(-50)).toBe(0)
  })
})

describe('applyBalanceSample', () => {
  it('makes the day\'s first sample the baseline and the last sample the current value', () => {
    const record = series(['100.00', '83.20'])
    expect(record?.day).toBe('2026-09-15')
    // First stays put, last moves: that difference IS the consumption.
    expect(record?.currencies['CNY']).toEqual({ first: 10_000, last: 8_320, recharge: 0 })
  })

  it('banks an increase as a top-up instead of reading it as negative consumption', () => {
    // The reported shape: ¥100.00 in the morning, a ¥100 top-up, then ¥30 of
    // spend down to ¥170.00 — the raw difference (100 − 170) is negative, and
    // the ¥10-step top-up is what recovers the real ¥30.
    const record = series(['100.00', '200.00', '170.00'])
    expect(record?.currencies['CNY']).toEqual({ first: 10_000, last: 17_000, recharge: 10_000 })
    expect(balanceDaySpendOf(record, balanceOf('170.00'), SAME_DAY)).toBe(30)
  })

  it('starts a fresh record on a new LOCAL day', () => {
    // A sample of the next day is that day's baseline: yesterday's first value
    // and top-ups belong to yesterday (the mirrored program attributes a
    // cross-midnight jump to the earlier day for the same reason).
    const yesterday = series(['100.00', '90.00'])
    const today = applyBalanceSample(yesterday, balanceOf('88.00'), NEXT_DAY)
    expect(today.day).toBe('2026-09-16')
    expect(today.currencies['CNY']).toEqual({ first: 8_800, last: 8_800, recharge: 0 })
    // A cross-midnight INCREASE is not today's top-up either: it is banked
    // nowhere, because the next day's record starts from the new sample.
    const afterTopUp = applyBalanceSample(yesterday, balanceOf('200.00'), NEXT_DAY)
    expect(afterTopUp.currencies['CNY']).toEqual({ first: 20_000, last: 20_000, recharge: 0 })
    expect(balanceDaySpendOf(afterTopUp, balanceOf('200.00'), NEXT_DAY)).toBe(0)
  })

  it('keeps a currency\'s samples when a later snapshot omits that line', () => {
    // A provider that reports a line intermittently must not reset the baseline
    // to the next sample it happens to send.
    const both = applyBalanceSample(null, {
      isAvailable: true,
      lines: [
        { currency: 'CNY', total: '100.00', granted: '0', toppedUp: '100' },
        { currency: 'USD', total: '10.00', granted: '0', toppedUp: '10' },
      ],
    }, DAY)
    const onlyUsd = applyBalanceSample(both, balanceOf('9.00', 'USD'), SAME_DAY)
    expect(onlyUsd.currencies['CNY']).toEqual({ first: 10_000, last: 10_000, recharge: 0 })
    expect(onlyUsd.currencies['USD']).toEqual({ first: 1_000, last: 900, recharge: 0 })
  })

  it('ignores a line whose amount is not a number', () => {
    const record = applyBalanceSample(null, balanceOf('—'), DAY)
    expect(record.currencies).toEqual({})
    expect(balanceDaySpendOf(record, balanceOf('—'), DAY)).toBeNull()
  })
})

describe('balanceDaySpendOf', () => {
  it('measures first − current + top-ups, in yuan', () => {
    const record = series(['100.00', '83.20'])
    expect(balanceDaySpendOf(record, balanceOf('83.20'), SAME_DAY)).toBe(16.8)
    // The FIRST sample of a day reads as exactly zero: nothing was spent yet.
    expect(balanceDaySpendOf(series(['100.00']), balanceOf('100.00'), DAY)).toBe(0)
  })

  it('reads ANY increase as a ¥10 top-up, exactly like the mirrored program', () => {
    // The rule is "an increase means a top-up, and top-ups are round tens", and
    // the reference `rechargeFromGrowth` has no minimum-growth guard either: a
    // ¥0.50 rise banks a whole ¥10, and the consumption therefore reads ¥9.50
    // (100.00 − 100.50 + 10). Faithful to the caliber the panel documents, not
    // clever about it.
    const record = series(['100.00', '100.50'])
    expect(record?.currencies['CNY']).toEqual({ first: 10_000, last: 10_050, recharge: 1_000 })
    expect(balanceDaySpendOf(record, balanceOf('100.50'), SAME_DAY)).toBe(9.5)
  })

  it('never prints a negative consumption', () => {
    // An amount HIGHER than the day's first sample with nothing banked against
    // it — the rise happened between two samples this browser never took — has
    // no explanation in the arithmetic; the mirrored program clamps at zero, and
    // so does this. (A rise the series DID see is banked as a top-up instead,
    // which is what keeps a real top-up-plus-spend day positive.)
    expect(balanceDaySpendOf(series(['100.00']), balanceOf('150.00'), SAME_DAY)).toBe(0)
  })

  it('stays hidden when today holds no sample for the amount\'s currency', () => {
    // Nothing measured is NOT a measured zero: the panel renders no rider at
    // all rather than a ¥0 a user would read as a figure.
    const record = series(['100.00', '83.20'])
    expect(balanceDaySpendOf(null, balanceOf('83.20'), DAY)).toBeNull()
    expect(balanceDaySpendOf(record, balanceOf('83.20'), NEXT_DAY)).toBeNull()
    expect(balanceDaySpendOf(record, balanceOf('9.00', 'USD'), SAME_DAY)).toBeNull()
    expect(balanceDaySpendOf(record, { isAvailable: true, lines: [] }, SAME_DAY)).toBeNull()
  })

  it('reads the snapshot\'s PRIMARY line, the one the panel prints', () => {
    // The panel's headline amount is `lines[0]`; the rider must measure the same
    // line, never a secondary currency.
    const record = applyBalanceSample(null, {
      isAvailable: true,
      lines: [
        { currency: 'CNY', total: '100.00', granted: '0', toppedUp: '100' },
        { currency: 'USD', total: '10.00', granted: '0', toppedUp: '10' },
      ],
    }, DAY)
    const later = applyBalanceSample(record, {
      isAvailable: true,
      lines: [
        { currency: 'CNY', total: '90.00', granted: '0', toppedUp: '90' },
        { currency: 'USD', total: '9.00', granted: '0', toppedUp: '9' },
      ],
    }, SAME_DAY)
    expect(balanceDaySpendOf(later, { isAvailable: true, lines: [{ currency: 'USD', total: '9.00', granted: '0', toppedUp: '9' }] }, SAME_DAY)).toBe(1)
  })
})

describe('decodeBalanceDayRecord', () => {
  it('reads back a record it wrote and rejects everything else', () => {
    const stored = JSON.stringify(series(['100.00', '83.20']))
    expect(decodeBalanceDayRecord(stored)).toEqual(series(['100.00', '83.20']))
    // Foreign JSON, another revision, and a non-numeric accumulator all read as
    // NO record: a corrupted store may cost a baseline, never throw in a render.
    expect(decodeBalanceDayRecord(null)).toBeNull()
    expect(decodeBalanceDayRecord('not json')).toBeNull()
    expect(decodeBalanceDayRecord('[]')).toBeNull()
    expect(decodeBalanceDayRecord('{"v":2,"day":"2026-09-15","currencies":{}}')).toBeNull()
    // A single unusable accumulator is dropped while the rest of the record
    // survives — one broken currency must not cost the day's whole baseline.
    expect(decodeBalanceDayRecord('{"v":1,"day":"2026-09-15","currencies":{"CNY":{"first":"x","last":1,"recharge":0}}}'))
      .toEqual({ v: 1, day: '2026-09-15', currencies: {} })
    expect(decodeBalanceDayRecord('{"v":1,"day":"2026-09-15","currencies":{"CNY":{"first":1,"last":1,"recharge":0},"USD":null}}'))
      .toEqual({ v: 1, day: '2026-09-15', currencies: { CNY: { first: 1, last: 1, recharge: 0 } } })
  })
})

describe('createBalanceDayTracker', () => {
  it('persists every sample so the day\'s baseline survives a reload', () => {
    const storage = memoryStorage()
    const first = createBalanceDayTracker(storage)
    first.record(balanceOf('100.00'), DAY)
    expect(balanceDaySpendOf(decodeBalanceDayRecord(storage.value), balanceOf('100.00'), DAY)).toBe(0)
    // A fresh tracker — the page reloaded — reads the SAME baseline back and
    // keeps accumulating, which is what makes the figure a whole day's rather
    // than one page's.
    const reloaded = createBalanceDayTracker(storage)
    expect(reloaded.spend(balanceOf('92.50'), SAME_DAY)).toBe(7.5)
    reloaded.record(balanceOf('92.50'), SAME_DAY)
    expect(reloaded.spend(balanceOf('92.50'), SAME_DAY)).toBe(7.5)
    expect(balanceDaySpendOf(decodeBalanceDayRecord(storage.value), balanceOf('92.50'), SAME_DAY)).toBe(7.5)
  })

  it('stays hidden before the day\'s first sample and on a later day', () => {
    const tracker = createBalanceDayTracker(memoryStorage())
    // Nothing sampled today: no figure (see balanceDaySpendOf).
    expect(tracker.spend(balanceOf('100.00'), DAY)).toBeNull()
    tracker.record(balanceOf('100.00'), DAY)
    expect(tracker.spend(balanceOf('100.00'), SAME_DAY)).toBe(0)
    // The same record read on the NEXT day is yesterday's: hidden again until
    // that day's own first sample lands.
    expect(tracker.spend(balanceOf('100.00'), NEXT_DAY)).toBeNull()
  })

  it('degrades to memory when the store is unusable', () => {
    // Private mode and blocked quotas throw on access; the balance display must
    // survive that, so both a missing and a throwing store keep working in
    // memory for the life of the page.
    const bare = createBalanceDayTracker()
    bare.record(balanceOf('100.00'), DAY)
    expect(bare.spend(balanceOf('90.00'), SAME_DAY)).toBe(10)

    const throwing: BalanceDayStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }
    const tracker = createBalanceDayTracker(throwing)
    expect(() => { tracker.record(balanceOf('100.00'), DAY) }).not.toThrow()
    expect(tracker.spend(balanceOf('90.00'), SAME_DAY)).toBe(10)
  })

  it('ignores a store that holds foreign or corrupted JSON', () => {
    const write = vi.fn()
    const tracker = createBalanceDayTracker({ getItem: () => '{"v":9}', setItem: write })
    // No usable baseline: the first sample of the day becomes the baseline.
    expect(tracker.spend(balanceOf('100.00'), DAY)).toBeNull()
    tracker.record(balanceOf('100.00'), DAY)
    expect(write).toHaveBeenCalledTimes(1)
    expect(tracker.spend(balanceOf('70.00'), SAME_DAY)).toBe(30)
  })
})
