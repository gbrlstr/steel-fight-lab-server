import data from './roster.json'
export const roster: Record<string, any> = data
export const WORLD_PER_SIM = 1 / 300
export const FIGHTER_TARGET_HEIGHT = 3.8
export const FIGHTER_PRESENCE = 1.35
// Authored VPK hurtboxes are ~550 tall. Use a shorter reference so COLLISION_SCALE
// grows with the body-normalized 3D models (head/hat/shoulders sit above the mesh).
const AUTHORED_BODY_HEIGHT = 420
export const COLLISION_SCALE = (FIGHTER_TARGET_HEIGHT * FIGHTER_PRESENCE) / (AUTHORED_BODY_HEIGHT * WORLD_PER_SIM)
// Only these globals are provisional; per-action explicit values come from the VPK.
export const RULES = { hz: 60, health: 2000, guard: 100, roundFrames: 5940, wins: 2, speed: 12, edge: 2400, commandWindow: 18, rollback: 120 }
export const IDLE = 'IDLE_ACTION_DEFINITION'
export type Input = { left?: boolean; right?: boolean; up?: boolean; down?: boolean; attack?: boolean; special?: boolean }
export type Fighter = { hero: string; x: number; face: number; hp: number; guard: number; action: string; age: number; stun: number; stop: number; connected: boolean; spawned: boolean; install: number; used: string[]; amp: number; ampPercent: number; combo: number; history: { frame: number; mask: number }[]; lastMask: number }
export type State = { frame: number; remaining: number; round: number; score: number[]; pause: number; winner: number | null; fighters: Fighter[]; projectiles: { owner: number; x: number; face: number; action: string; life: number; id: string }[]; events: { id: string; kind: string; x: number; face: number; hero: string; action: string }[] }
export function fighter(hero: string, x: number, face: number): Fighter { return { hero, x, face, hp: RULES.health, guard: RULES.guard, action: IDLE, age: 0, stun: 0, stop: 0, connected: false, spawned: false, install: 0, used: [], amp: 0, ampPercent: 0, combo: 0, history: [], lastMask: 0 } }
export function initial(a = 'tusk', b = 'tusk'): State { return { frame: 0, remaining: RULES.roundFrames, round: 1, score: [0, 0], pause: 0, winner: null, fighters: [fighter(a, -600, 1), fighter(b, 600, -1)], projectiles: [], events: [] } }
export const action = (f: Fighter) => roster[f.hero].m_vecActionDefinitions.find((a: any) => a.m_nActionID === f.action) ?? roster[f.hero].m_vecActionDefinitions[0]
const bits: Record<string, number> = { FORWARD: 1, BACK: 2, DOWN: 4, UP: 8, ATTACK: 16, SPECIAL: 32 }
/** A+S+D / ←+↓+→: both horizontals + down (bits FORWARD|BACK|DOWN). */
export const isGuardInput = (mask: number) => (mask & 7) === 7
export function relative(input: Input, face: number) { return (input.right ? (face === 1 ? 1 : 2) : 0) | (input.left ? (face === 1 ? 2 : 1) : 0) | (input.down ? 4 : 0) | (input.up ? 8 : 0) | (input.attack ? 16 : 0) | (input.special ? 32 : 0) }
function mask(s: string) { return s.split('|').reduce((v, k) => v | (bits[k.replace('kBUTTON_', '').replace('_BIT', '')] ?? 0), 0) }
function change(f: Fighter, id: string) { f.action = id; f.age = 0; f.connected = false; f.spawned = false; const a = action(f); if (a.m_bSingleUse) f.used.push(id) }
function command(f: Fighter, c: any, frame: number) {
    if (c.m_bRequiresInstall && !f.install) return false
    if (f.used.includes(c.m_nCancelActionID)) return false
    if (f.age < (c.m_nCancelStart ?? 0)) return false
    if (f.action !== IDLE && !f.connected && !c.m_bAllowCancelOnWhiff) return false
    const sequence = [c.m_eCancelInput, c.m_eCancelInput2, c.m_eCancelInput3].filter(Boolean).map(mask)
    if (!sequence.length) return true
    let end = f.history.length - 1
    for (let k = sequence.length - 1; k >= 0; k--) { let found = false; for (; end >= 0; end--) { const h = f.history[end]; if (frame - h.frame > RULES.commandWindow) return false; if (k === sequence.length - 1 && frame - h.frame > (c.m_eCancelInputBuffer ?? 2)) return false; if ((h.mask & sequence[k]) === sequence[k]) { found = true; end--; break } } if (!found) return false }
    return true
}
// Authored boxes are in VPK units. Scale them onto the taller fight models so a punch that
// meets the body also meets the box — Tusk's belly was several times wider than his hurtbox.
export function volume(origin: { x: number; face: number }, b: any) { const s = COLLISION_SCALE; const x1 = origin.x + b.m_vMinBounds[0] * s * origin.face, x2 = origin.x + b.m_vMaxBounds[0] * s * origin.face; return [Math.min(x1, x2), Math.max(x1, x2), b.m_vMinBounds[1] * s, b.m_vMaxBounds[1] * s] }
function bounds(f: Fighter, b: any) { return volume(f, b) }
// Authored strikes sit in front of the body. These replacements follow the weapon/limb actually
// drawn during the hit window (measured in fight scale), so a swing that lands behind or
// past the VPK box still connects where the player sees it.
function fitBox(box: any, x0: number, x1: number, y0: number, y1: number) { const min = box.m_vMinBounds, max = box.m_vMaxBounds; return { ...box, m_vMinBounds: [x0, y0, min[2]], m_vMaxBounds: [x1, y1, max[2]] } }
const visualStrike: Record<string, Record<string, [number, number, number, number]>> = {
    tusk: {
        // Stocky fists — keep reach near the glove/fish, not the old mid-screen VPK slabs.
        JAB_ACTION_DEFINITION: [120, 340, -600, -100], JAB_2_ACTION_DEFINITION: [110, 355, -600, -100],
        CROSS_ACTION_DEFINITION: [130, 380, -580, -110], SWEEP_ACTION_DEFINITION: [140, 400, -480, -90],
        FINISHER_ACTION_DEFINITION: [110, 390, -780, -60],
        // Walrus Punch uppercut — tall, short forward reach.
        WALRUS_PUNCH_ACTION_DEFINITION: [120, 380, -800, -40],
    },
    bristleback: {
        JAB_ACTION_DEFINITION: [110, 330, -600, -100], JAB_2_ACTION_DEFINITION: [100, 345, -600, -100],
        CROSS_ACTION_DEFINITION: [120, 370, -580, -110], SWEEP_ACTION_DEFINITION: [130, 390, -480, -90],
        FINISHER_ACTION_DEFINITION: [100, 380, -780, -60],
        // Quill Spray is a body-centered burst — keep radius near the spines, not mid-screen.
        QUILLSPRAY_START_ACTION_DEFINITION: [-175, 175, -520, -60], QUILLSPRAY_2_ACTION_DEFINITION: [-190, 190, -530, -55],
        QUILLSPRAY_3_ACTION_DEFINITION: [-205, 205, -540, -50], QUILLSPRAY_4_ACTION_DEFINITION: [-215, 215, -550, -45],
        QUILLSPRAY_FINISH_ACTION_DEFINITION: [-230, 230, -560, -40],
    },
    vengeful: {
        JAB_ACTION_DEFINITION: [40, 520, -640, -40], JAB_2_ACTION_DEFINITION: [40, 640, -640, -40],
        CROSS_ACTION_DEFINITION: [20, 820, -660, -50], SWEEP_ACTION_DEFINITION: [80, 920, -480, -20],
        FINISHER_ACTION_DEFINITION: [40, 620, -820, -30], SWAP_ACTION_DEFINITION: [80, 1600, -560, -40],
    },
    marci: {
        // Reach tuned for current COLLISION_SCALE — keep fists near the posed limb, not mid-screen.
        JAB_ACTION_DEFINITION: [100, 340, -600, -80], JAB_2_ACTION_DEFINITION: [100, 350, -600, -80], JAB_3_ACTION_DEFINITION: [100, 365, -620, -70],
        CROSS_ACTION_DEFINITION: [90, 355, -600, -80], CROSS_2_ACTION_DEFINITION: [90, 365, -600, -80], CROSS_3_ACTION_DEFINITION: [90, 380, -620, -70],
        FINISHER_ACTION_DEFINITION: [80, 400, -800, -50], FINISHER_2_ACTION_DEFINITION: [80, 415, -820, -40],
        SWEEP_ACTION_DEFINITION: [120, 430, -500, -60],
        KICK_1_ACTION_DEFINITION: [120, 440, -520, -70], KICK_2_ACTION_DEFINITION: [120, 450, -520, -70], KICK_3_ACTION_DEFINITION: [110, 465, -540, -60],
        DASH_STRIKE_ACTION_DEFINITION: [140, 320, -580, -100], DASH_STRIKE_2_ACTION_DEFINITION: [140, 335, -600, -90],
    },
    dawnbreaker: {
        // Keep strike near the hammer head — previous reach was connecting across open space.
        JAB_ACTION_DEFINITION: [150, 310, -600, -120], JAB_2_ACTION_DEFINITION: [150, 325, -600, -120],
        SWEEP_ACTION_DEFINITION: [160, 360, -500, -120], SWEEP_2_ACTION_DEFINITION: [160, 375, -500, -110],
        STARBREAKER_1_ACTION_DEFINITION: [150, 335, -580, -130], STARBREAKER_2_ACTION_DEFINITION: [150, 350, -560, -130],
        STARBREAKER_3_ACTION_DEFINITION: [150, 340, -520, -110],
        LUMINOSITY_ACTION_DEFINITION: [140, 345, -740, -100],
    },
}
// Traveling skills were a standing-height slab. These sit on the drawn sprite or model.
const visualShot: Record<string, Record<string, [number, number, number, number]>> = {
    tusk: { PROJECTILE_ACTION_DEFINITION: [-50, 55, -125, -10] },
    bristleback: { PROJECTILE_ACTION_DEFINITION: [-40, 40, -200, -110] },
    vengeful: { PROJECTILE_ACTION_DEFINITION: [-70, 70, -280, -80] },
}
export function shotBox(hero: string, id: string, box: any) { const fit = visualShot[hero]?.[id]; return fit ? fitBox(box, fit[0], fit[1], fit[2], fit[3]) : box }
function visualBox(hero: string, id: string, box: any) { const fit = visualStrike[hero]?.[id]; return fit ? fitBox(box, fit[0], fit[1], fit[2], fit[3]) : box }
export function strikeBox(f: Fighter) { const a = action(f); if (!a.m_HitBox || a.m_flProjectileSpeed || f.connected || f.stop > 0) return null; const start = a.m_nHitBoxStart ?? 0; if (f.age < start || f.age >= start + (a.m_nHitBoxDuration ?? 0)) return null; return visualBox(f.hero, f.action, a.m_HitBox) }
// Visual hurtboxes follow the posed 3D body (wider belly / shoulders than the VPK slabs).
const visualHurt: Record<string, Record<string, [number, number, number, number]>> = {
    tusk: {
        IDLE_ACTION_DEFINITION: [-220, 240, -560, 0], BLOCKSTUN_ACTION_DEFINITION: [-220, 240, -560, 0], HITSTUN_ACTION_DEFINITION: [-220, 240, -560, 0],
        DASH_ACTION_DEFINITION: [-220, 240, -560, 0], BACKDASH_ACTION_DEFINITION: [-220, 240, -560, 0], GUARDBREAK_ACTION_DEFINITION: [-220, 240, -560, 0],
        VICTORY_ACTION_DEFINITION: [-220, 240, -560, 0], DEFEAT_ACTION_DEFINITION: [-160, 160, -560, 0], KNOCKED_DOWN_ACTION_DEFINITION: [-260, 260, -320, 0],
        JAB_ACTION_DEFINITION: [-180, 320, -540, 0], JAB_2_ACTION_DEFINITION: [-180, 330, -540, 0],
        CROSS_ACTION_DEFINITION: [-200, 350, -560, 0], SWEEP_ACTION_DEFINITION: [-220, 370, -520, 0],
        PROJECTILE_ACTION_DEFINITION: [-200, 280, -560, 0],
        FINISHER_ACTION_DEFINITION: [-210, 360, -700, 0], WALRUS_PUNCH_ACTION_DEFINITION: [-200, 350, -820, 0],
    },
    vengeful: {
        IDLE_ACTION_DEFINITION: [-90, 210, -580, 0], BLOCKSTUN_ACTION_DEFINITION: [-90, 210, -580, 0], HITSTUN_ACTION_DEFINITION: [-90, 210, -580, 0],
        DASH_ACTION_DEFINITION: [-90, 210, -580, 0], BACKDASH_ACTION_DEFINITION: [-90, 210, -580, 0], GUARDBREAK_ACTION_DEFINITION: [-90, 210, -580, 0],
        VICTORY_ACTION_DEFINITION: [-90, 210, -580, 0], DEFEAT_ACTION_DEFINITION: [-70, 160, -580, 0], KNOCKED_DOWN_ACTION_DEFINITION: [-180, 220, -300, 0],
        JAB_ACTION_DEFINITION: [-90, 360, -580, 0], JAB_2_ACTION_DEFINITION: [-90, 420, -580, 0],
        CROSS_ACTION_DEFINITION: [-110, 480, -600, 0], SWEEP_ACTION_DEFINITION: [-120, 520, -560, 0],
        PROJECTILE_ACTION_DEFINITION: [-160, 260, -580, 0], FINISHER_ACTION_DEFINITION: [-100, 460, -700, 0],
        SWAP_ACTION_DEFINITION: [-90, 240, -580, 0], SWAP_RECOVERY_ACTION_DEFINITION: [-90, 210, -580, 0],
    },
    bristleback: {
        IDLE_ACTION_DEFINITION: [-150, 170, -560, 0], BLOCKSTUN_ACTION_DEFINITION: [-150, 170, -560, 0], HITSTUN_ACTION_DEFINITION: [-150, 170, -560, 0],
        DASH_ACTION_DEFINITION: [-150, 170, -560, 0], BACKDASH_ACTION_DEFINITION: [-150, 170, -560, 0], GUARDBREAK_ACTION_DEFINITION: [-150, 170, -560, 0],
        VICTORY_ACTION_DEFINITION: [-150, 170, -560, 0], DEFEAT_ACTION_DEFINITION: [-120, 140, -560, 0], KNOCKED_DOWN_ACTION_DEFINITION: [-210, 210, -300, 0],
        JAB_ACTION_DEFINITION: [-140, 300, -560, 0], JAB_2_ACTION_DEFINITION: [-140, 310, -560, 0],
        CROSS_ACTION_DEFINITION: [-150, 330, -560, 0], SWEEP_ACTION_DEFINITION: [-150, 340, -520, 0],
        FINISHER_ACTION_DEFINITION: [-150, 350, -700, 0], PROJECTILE_ACTION_DEFINITION: [-160, 240, -560, 0],
        QUILLSPRAY_START_ACTION_DEFINITION: [-180, 200, -580, 0], QUILLSPRAY_2_ACTION_DEFINITION: [-185, 205, -580, 0],
        QUILLSPRAY_3_ACTION_DEFINITION: [-190, 210, -590, 0], QUILLSPRAY_4_ACTION_DEFINITION: [-195, 215, -590, 0],
        QUILLSPRAY_FINISH_ACTION_DEFINITION: [-200, 220, -600, 0],
    },
    marci: {
        IDLE_ACTION_DEFINITION: [-130, 150, -560, 0], BLOCKSTUN_ACTION_DEFINITION: [-130, 150, -560, 0], HITSTUN_ACTION_DEFINITION: [-130, 150, -560, 0],
        DASH_ACTION_DEFINITION: [-130, 150, -560, 0], BACKDASH_ACTION_DEFINITION: [-130, 150, -560, 0], GUARDBREAK_ACTION_DEFINITION: [-130, 150, -560, 0],
        VICTORY_ACTION_DEFINITION: [-130, 150, -560, 0], DEFEAT_ACTION_DEFINITION: [-100, 120, -560, 0], KNOCKED_DOWN_ACTION_DEFINITION: [-200, 200, -300, 0],
        JAB_ACTION_DEFINITION: [-120, 320, -560, 0], JAB_2_ACTION_DEFINITION: [-120, 340, -560, 0], JAB_3_ACTION_DEFINITION: [-120, 360, -580, 0],
        CROSS_ACTION_DEFINITION: [-130, 360, -560, 0], CROSS_2_ACTION_DEFINITION: [-130, 380, -560, 0], CROSS_3_ACTION_DEFINITION: [-130, 400, -580, 0],
        FINISHER_ACTION_DEFINITION: [-140, 420, -700, 0], FINISHER_2_ACTION_DEFINITION: [-140, 440, -720, 0],
        SWEEP_ACTION_DEFINITION: [-140, 420, -540, 0],
        KICK_1_ACTION_DEFINITION: [-140, 440, -540, 0], KICK_2_ACTION_DEFINITION: [-140, 460, -540, 0], KICK_3_ACTION_DEFINITION: [-150, 480, -560, 0],
        DASH_STRIKE_ACTION_DEFINITION: [-100, 420, -580, 0], DASH_STRIKE_2_ACTION_DEFINITION: [-100, 460, -600, 0],
        UNLEASH_ACTION_DEFINITION: [-140, 220, -620, 0],
    },
    dawnbreaker: {
        IDLE_ACTION_DEFINITION: [-150, 160, -580, 0], BLOCKSTUN_ACTION_DEFINITION: [-150, 160, -580, 0], HITSTUN_ACTION_DEFINITION: [-150, 160, -580, 0],
        DASH_ACTION_DEFINITION: [-150, 160, -580, 0], BACKDASH_ACTION_DEFINITION: [-150, 160, -580, 0], GUARDBREAK_ACTION_DEFINITION: [-150, 160, -580, 0],
        VICTORY_ACTION_DEFINITION: [-150, 160, -580, 0], DEFEAT_ACTION_DEFINITION: [-120, 140, -580, 0], KNOCKED_DOWN_ACTION_DEFINITION: [-210, 210, -300, 0],
        JAB_ACTION_DEFINITION: [-140, 280, -600, 0], JAB_2_ACTION_DEFINITION: [-140, 290, -600, 0],
        SWEEP_ACTION_DEFINITION: [-150, 310, -560, 0], SWEEP_2_ACTION_DEFINITION: [-150, 320, -560, 0],
        STARBREAKER_1_ACTION_DEFINITION: [-140, 300, -600, 0], STARBREAKER_2_ACTION_DEFINITION: [-140, 310, -580, 0],
        STARBREAKER_3_ACTION_DEFINITION: [-145, 300, -560, 0], LUMINOSITY_ACTION_DEFINITION: [-150, 300, -700, 0],
    },
}
function fittedHurt(hero: string, id: string, box: any) { const fit = visualHurt[hero]?.[id]; return fit ? fitBox(box, fit[0], fit[1], fit[2], fit[3]) : box }
export function hurtBox(f: Fighter) { const box = action(f).m_HurtBox ?? roster[f.hero].m_vecActionDefinitions[0].m_HurtBox; return fittedHurt(f.hero, f.action, box) }
function overlaps(a: number[], b: number[]) { return a[0] <= b[1] && a[1] >= b[0] && a[2] <= b[3] && a[3] >= b[2] }
function hit(s: State, owner: number, a: any, x: number, face: number, projectile = false) {
    const f = s.fighters[owner], t = s.fighters[1 - owner], ta = action(t)
    const inv = ta.m_nInvulnerabilityFlags ?? ''
    if (t.age >= (ta.m_nInvulnerabilityStart ?? 0) && t.age < (ta.m_nInvulnerabilityStart ?? 0) + (ta.m_nInvulnerabilityDuration ?? 0) && inv.includes(projectile ? 'PROJECTILE' : 'STRIKE')) return false
    if (!a.m_HitBox || !overlaps(bounds({ ...f, x, face }, projectile ? shotBox(f.hero, a.m_nActionID, a.m_HitBox) : visualBox(f.hero, a.m_nActionID, a.m_HitBox)), bounds(t, hurtBox(t)))) return false
    const blocking = isGuardInput(t.lastMask) && (!t.stun || t.action === 'BLOCKSTUN_ACTION_DEFINITION') && (t.action === IDLE || t.action === 'BLOCKSTUN_ACTION_DEFINITION')
    const damage = blocking ? (a.m_flChipDamage ?? 0) : (a.m_flHitDamage ?? 0) * (1 + (t.amp ? t.ampPercent : 0) / 100)
    t.hp = Math.max(0, t.hp - Math.round(damage)); f.connected = true
    if (blocking) t.guard = Math.max(0, t.guard - (a.m_flGuardDamage ?? 0))
    else { f.combo++; if (a.m_nDamageAmpFrames) { t.amp = a.m_nDamageAmpFrames; t.ampPercent = a.m_fDamageAmpPercent } if (a.m_flHealOnDamage) f.hp = Math.min(RULES.health, f.hp + a.m_flHealOnDamage) }
    const guardbreak = blocking && t.guard === 0
    change(t, guardbreak ? 'GUARDBREAK_ACTION_DEFINITION' : blocking ? 'BLOCKSTUN_ACTION_DEFINITION' : 'HITSTUN_ACTION_DEFINITION')
    t.stun = guardbreak ? 30 : Math.max(1, (a.m_nDuration ?? 30) - f.age + (blocking ? (a.m_nOnBlockFrames ?? 0) : (a.m_nOnHitFrames ?? 0)))
    if (guardbreak) t.guard = RULES.guard
    f.stop = t.stop = blocking ? (a.m_nBlockStop ?? 0) : (a.m_nHitStop ?? 0)
    t.x += face * (blocking ? (a.m_flPushbackOnBlock ?? 0) : (a.m_flPushbackOnHit ?? 0))
    // Swap is an engine action enum, not a conventional-Dota ability mapping.
    // The position exchange interpretation still needs comparison with original playback.
    if (a.m_nActionID === 'SWAP_ACTION_DEFINITION' && !blocking) {
        const from = f.x, to = t.x
        f.x = to; t.x = from; f.face *= -1; t.face *= -1
        s.events.push({ id: `${s.round}:${s.frame}:${owner}:swapA`, kind: 'swap', x: from, face, hero: f.hero, action: a.m_nActionID })
        s.events.push({ id: `${s.round}:${s.frame}:${owner}:swapB`, kind: 'swap', x: to, face: -face, hero: f.hero, action: a.m_nActionID })
    }
    s.events.push({ id: `${s.round}:${s.frame}:${owner}:${projectile ? 'p' : 'h'}`, kind: blocking ? 'block' : 'hit', x: t.x, face, hero: f.hero, action: a.m_nActionID }); return true
}
function place(s: State) {
    const width = (hero: string) => roster[hero].m_flHeroWidth * COLLISION_SCALE
    for (const f of s.fighters) { const half = width(f.hero) / 2; f.x = Math.max(-RULES.edge + half, Math.min(RULES.edge - half, f.x)) }
    const [l, r] = s.fighters[0].x <= s.fighters[1].x ? s.fighters : [s.fighters[1], s.fighters[0]]; const separation = (width(l.hero) + width(r.hero)) / 2
    if (r.x - l.x < separation) { const mid = (l.x + r.x) / 2; const minLeft = -RULES.edge + roster[l.hero].m_flHeroWidth / 2, maxRight = RULES.edge - roster[r.hero].m_flHeroWidth / 2; l.x = Math.max(minLeft, Math.min(maxRight - separation, mid - separation / 2)); r.x = l.x + separation }
}
// Pre-round: walk and idle, but attacks, dashes and the timer stay locked.
function move(previous: State, inputs: Input[]): State {
    if (previous.winner !== null || previous.pause > 0) return previous
    const s = structuredClone(previous); s.events = []
    for (let i = 0; i < 2; i++) {
        const f = s.fighters[i]; if (f.action !== IDLE) continue
        const other = s.fighters[1 - i]; f.face = other.x >= f.x ? 1 : -1
        const raw = inputs[i] ?? {}
        const m = relative({ left: raw.left, right: raw.right }, f.face)
        f.lastMask = m
        f.x += (Number(!!raw.right) - Number(!!raw.left)) * RULES.speed
        f.age++
    }
    place(s)
    return s
}
export function step(previous: State, inputs: Input[], mode: 'play' | 'move' = 'play'): State {
    if (mode === 'move') return move(previous, inputs)
    const s = structuredClone(previous); s.frame++; s.events = []
    if (s.winner !== null) return s
    if (s.pause > 0) { if (--s.pause === 0) { s.round++; s.remaining = RULES.roundFrames; s.fighters = s.fighters.map((f, i) => fighter(f.hero, i ? 600 : -600, i ? -1 : 1)); s.projectiles = [] } return s }
    s.remaining--
    for (let i = 0; i < 2; i++) {
        const f = s.fighters[i], other = s.fighters[1 - i]; if (f.action === IDLE) f.face = other.x >= f.x ? 1 : -1
        const m = relative(inputs[i] ?? {}, f.face); if (m !== f.lastMask) { f.history.push({ frame: s.frame, mask: m }); f.lastMask = m } f.history = f.history.filter(h => s.frame - h.frame <= RULES.commandWindow)
        if (f.install) f.install--; if (f.amp) f.amp--
        if (f.stop) { f.stop--; continue }
        if (f.stun) { f.stun--; f.age++; if (!f.stun) { change(f, IDLE); other.combo = 0 } continue }
        let a = action(f)
        const c = (a.m_vecCancelOptions ?? []).find((c: any) => command(f, c, s.frame))
        // A+S+D is guard — don't treat DOWN inside the chord as a special cancel.
        if (c && !isGuardInput(m)) { change(f, c.m_nCancelActionID); f.history = []; a = action(f) }
        if (f.action === IDLE) {
            if (!isGuardInput(m)) {
                const dir = Number(!!inputs[i]?.right) - Number(!!inputs[i]?.left)
                f.x += dir * RULES.speed
                const taps = f.history.filter(h => h.mask === (m & 3) && h.mask !== 0)
                if (!(m & 48) && taps.length >= 2 && s.frame - taps.at(-1)!.frame < 2) { change(f, (m & 1) ? 'DASH_ACTION_DEFINITION' : 'BACKDASH_ACTION_DEFINITION'); f.history = []; a = action(f) }
            }
        }
        const dash = f.action === 'DASH_ACTION_DEFINITION' || f.action === 'BACKDASH_ACTION_DEFINITION'
        if (dash || (a.m_nDashDuration && f.age >= a.m_nDashStart && f.age < a.m_nDashStart + a.m_nDashDuration)) f.x += f.face * (f.action === 'BACKDASH_ACTION_DEFINITION' ? -1 : 1) * RULES.speed * (a.m_flDashSpeedMultiplier ?? 3)
        if (a.m_nInstallFrames && f.age === a.m_nInstallStart) {
            f.install = a.m_nInstallFrames
            s.events.push({ id: `${s.round}:${s.frame}:${i}:install`, kind: 'install', x: f.x, face: f.face, hero: f.hero, action: f.action })
        }
        if (a.m_flProjectileSpeed && !f.spawned && f.age === a.m_nHitBoxStart) { s.projectiles.push({ owner: i, x: f.x, face: f.face, action: f.action, life: 180, id: `${s.frame}:${i}` }); f.spawned = true }
    }
    // Evaluate both strikes before applying stun so simultaneous hits can trade.
    const strikes = s.fighters.map(f => ({ a: action(f), age: f.age, connected: f.connected, stopped: f.stop > 0, x: f.x, face: f.face }))
    for (let i = 0; i < 2; i++) { const k = strikes[i]; if (!k.connected && !k.stopped && !k.a.m_flProjectileSpeed && k.age >= k.a.m_nHitBoxStart && k.age < k.a.m_nHitBoxStart + k.a.m_nHitBoxDuration) hit(s, i, k.a, k.x, k.face) }
    s.projectiles = s.projectiles.filter(p => { const a = roster[s.fighters[p.owner].hero].m_vecActionDefinitions.find((a: any) => a.m_nActionID === p.action); p.x += p.face * a.m_flProjectileSpeed / 60; return --p.life > 0 && Math.abs(p.x) < RULES.edge + 500 && !hit(s, p.owner, a, p.x, p.face, true) })
    for (const f of s.fighters) { if (!f.stop && !f.stun) { f.age++; if (f.action !== IDLE && f.age >= (action(f).m_nDuration ?? 30)) change(f, IDLE) } }
    place(s)
    if (s.remaining <= 0 || s.fighters.some(f => f.hp <= 0)) {
        const [a, b] = s.fighters; const win = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1
        if (win >= 0) { s.score[win]++; change(s.fighters[win], 'VICTORY_ACTION_DEFINITION'); change(s.fighters[1 - win], 'DEFEAT_ACTION_DEFINITION'); if (s.score[win] >= RULES.wins) s.winner = win; else s.pause = 150 }
        else s.pause = 150
    }
    return s
}
export function checksum(s: State) { const str = JSON.stringify(s); let h = 2166136261; for (let i = 0; i < str.length; i++)h = Math.imul(h ^ str.charCodeAt(i), 16777619); return (h >>> 0).toString(16) }

