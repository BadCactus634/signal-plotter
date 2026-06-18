export type ViewMode = 'time' | 'discrete' | 'frequency'

export type SignalKind =
  | 'sine'
  | 'cosine'
  | 'step'
  | 'impulse'
  | 'rect'
  | 'triangle'
  | 'sum'
  | 'product'
  | 'delay'
  | 'conv'
  | 'sgn'
  | 'complexExp'
  | 'periodicExt'
  | 'discreteExp'
  | 'rectN'
  | 'triN'

export type SignalNode =
  | { kind: 'constant'; value: number }
  | { kind: 'formula'; expression: string }
  | { kind: 'sine'; amplitude: number; frequency: number; phase: number; offset: number }
  | { kind: 'cosine'; amplitude: number; frequency: number; phase: number; offset: number }
  | { kind: 'step'; height: number; shift: number }
  | { kind: 'impulse'; amplitude: number; shift: number }
  | { kind: 'rect'; width: number; height: number; center: number }
  | { kind: 'triangle'; width: number; height: number; center: number }
  | { kind: 'delay'; amount: number; child: SignalNode }
  | { kind: 'sum'; children: SignalNode[] }
  | { kind: 'product'; children: SignalNode[] }
  | { kind: 'conv'; left: SignalNode; right: SignalNode }
  | { kind: 'sgn' }
  | { kind: 'complexExp'; f0: number; phi: number }
  | { kind: 'periodicExt'; prototype: SignalNode; period: number }
  | { kind: 'discreteExp'; base: number }
  | { kind: 'rectN'; N: number }
  | { kind: 'triN'; N: number }

export type ParseResult =
  | { ok: true; signal: SignalNode }
  | { ok: false; error: string }

export type SignalSample = { x: number; y: number }

export type ImpulseMarker = { position: number; amplitude: number }

export type SignalStats = {
  peak: number
  min: number
  max: number
  energy: number
  averagePower: number
  zeroCrossings: number
  estimatedPeriod: number | null
  estimatedFrequency: number | null
  classification: 'energy' | 'power' | 'finite-window'
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const TOKEN_REGEX = /\s*(\\pi|π|[A-Za-z_][A-Za-z0-9_]*|\d*\.\d+|\d+|\+|-|\*|\/|\^|\(|\)|\[|\]|,)/gy

function tokenize(expression: string): string[] {
  const tokens: string[] = []
  TOKEN_REGEX.lastIndex = 0
  let match = TOKEN_REGEX.exec(expression)
  while (match) {
    tokens.push(match[1])
    match = TOKEN_REGEX.exec(expression)
  }
  return tokens
}

function isPiToken(token: string | undefined): boolean {
  return token === 'π' || token === 'pi'
}

function isNumberToken(token: string | undefined): boolean {
  return typeof token === 'string' && (/^\d*\.\d+$/.test(token) || /^\d+$/.test(token))
}

function isIdentifierToken(token: string | undefined): boolean {
  return typeof token === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)
}

// ─── Formula functions ────────────────────────────────────────────────────────

const FORMULA_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  abs: Math.abs,
  exp: Math.exp,
  sqrt: Math.sqrt,
  log: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  sign: Math.sign,
  // ε(t): 0.5 at t=0 (def. corso Dalai)
  step: (value) => Math.abs(value) < 1e-10 ? 0.5 : value > 0 ? 1 : 0,
  u: (value) => Math.abs(value) < 1e-10 ? 0.5 : value > 0 ? 1 : 0,
  // rect(t, w=1): 1 per |t|<w/2, 0.5 per |t|=w/2
  rect: (value, width = 1) => {
    const dist = Math.abs(value)
    const half = (width || 1) / 2
    if (Math.abs(dist - half) < 1e-10) return 0.5
    return dist < half ? 1 : 0
  },
  // tri(t, h=1): 1-|t/h| per |t|≤h (halfWidth convention: tri(t)=1-|t| per |t|≤1)
  tri: (value, halfWidth = 1) => {
    const dist = Math.abs(value)
    const h = halfWidth || 1
    if (dist > h) return 0
    return 1 - dist / h
  },
  // delta approssimato con soglia 0.04 (circa metà del passo tipico di campionamento)
  delta: (value) => Math.abs(value) < 0.04 ? 1 : 0,
  // sinc normalizzato: sinc(t) = sin(πt)/(πt), sinc(0)=1
  sinc: (value) => Math.abs(value) < 1e-9 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value),
  sgn: (value) => Math.abs(value) < 1e-10 ? 0 : value > 0 ? 1 : -1,
}

const formulaCache = new Map<string, (x: number) => number>()

// ─── FormulaParser ────────────────────────────────────────────────────────────

class FormulaParser {
  private readonly tokens: string[]
  private index = 0
  readonly scope: Record<string, number> = {
    x: 0, t: 0, tau: 0, n: 0, k: 0, f: 0, omega: 0,
    a: 1, b: 1, phi: 0, theta: 0, phi0: 0, t0: 0, a0: 1, b0: 1,
  }

  constructor(expression: string) {
    this.tokens = tokenize(expression)
  }

  parse(): number {
    const value = this.parseSum()
    if (!this.isAtEnd()) throw new Error(`Unexpected token: ${this.peek()}`)
    return value
  }

  private parseSum(): number {
    let value = this.parseProduct()
    while (this.match('+') || this.match('-')) {
      const op = this.previous()
      const right = this.parseProduct()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  private parseProduct(): number {
    let value = this.parsePower()
    while (true) {
      if (this.match('*')) { value *= this.parsePower(); continue }
      if (this.match('/')) {
        const d = this.parsePower()
        value = d === 0 ? 0 : value / d
        continue
      }
      if (this.isImplicitProductStart(this.peek())) { value *= this.parsePower(); continue }
      break
    }
    return value
  }

  private parsePower(): number {
    let value = this.parseUnary()
    if (this.match('^')) value = Math.pow(value, this.parsePower())
    return value
  }

  private parseUnary(): number {
    if (this.match('+')) return this.parseUnary()
    if (this.match('-')) return -this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.peek()
    if (isNumberToken(token)) { this.advance(); return Number(token) }
    if (isPiToken(token)) { this.advance(); return Math.PI }
    if (isIdentifierToken(token)) {
      const name = (token ?? '').toLowerCase()
      this.advance()
      if (this.match('(')) {
        const args: number[] = []
        if (!this.match(')')) {
          do { args.push(this.parseSum()) } while (this.match(','))
          this.consume(')')
        }
        if (name === 'x' && args.length === 1) return args[0]
        return this.evaluateFunction(name, args)
      }
      if (name === 'pi' || name === 'π') return Math.PI
      if (name === 'e') return Math.E
      return this.scopeValue(name)
    }
    if (this.match('(')) {
      const value = this.parseSum()
      this.consume(')')
      return value
    }
    throw new Error(`Unexpected token: ${token ?? 'end of input'}`)
  }

  private evaluateFunction(name: string, args: number[]): number {
    const fn = FORMULA_FUNCTIONS[name]
    if (!fn) {
      if (args.length === 1) return args[0]
      throw new Error(`Unknown function: ${name}`)
    }
    return fn(...args)
  }

  private scopeValue(name: string): number {
    if (name === 'x' || name === 't' || name === 'tau' || name === 'n' || name === 'k' || name === 'f' || name === 'omega') {
      return this.scope[name] ?? this.scope.x
    }
    return this.scope[name] ?? 0
  }

  private match(expected: string): boolean {
    if (this.peek() !== expected) return false
    this.index++; return true
  }

  private consume(expected: string): void {
    if (!this.match(expected)) throw new Error(`Expected '${expected}' but found '${this.peek() ?? 'end of input'}'`)
  }

  private peek(offset = 0): string | undefined { return this.tokens[this.index + offset] }
  private previous(): string | undefined { return this.tokens[this.index - 1] }
  private advance(): void { this.index++ }
  private isAtEnd(): boolean { return this.index >= this.tokens.length }
  private isImplicitProductStart(token: string | undefined): boolean {
    return token === '(' || isNumberToken(token) || isIdentifierToken(token) || isPiToken(token)
  }
}

function compileFormula(expression: string): (x: number) => number {
  const cached = formulaCache.get(expression)
  if (cached) return cached
  const evaluator = (x: number) => {
    const parser = new FormulaParser(expression)
    parser.scope.x = x; parser.scope.t = x; parser.scope.tau = x
    parser.scope.n = x; parser.scope.k = x; parser.scope.f = x; parser.scope.omega = x
    return parser.parse()
  }
  formulaCache.set(expression, evaluator)
  return evaluator
}

// Estrae gli argomenti di una funzione dal raw string, rispettando la profondità
// Esempio: "conv(rect(t), step(t))" → ["rect(t)", "step(t)"]
function splitFunctionArgs(expr: string): string[] {
  const openIdx = expr.indexOf('(')
  if (openIdx === -1) return []
  let depth = 0
  let start = openIdx + 1
  const args: string[] = []
  for (let i = openIdx; i < expr.length; i++) {
    const c = expr[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') {
      depth--
      if (depth === 0) {
        const arg = expr.slice(start, i).trim()
        if (arg) args.push(arg)
        break
      }
    } else if (c === ',' && depth === 1) {
      args.push(expr.slice(start, i).trim())
      start = i + 1
    }
  }
  return args
}

// Trova il primo '*' al livello 0 di profondità
function splitTopLevelStar(expression: string): [string, string] | null {
  let depth = 0
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i]
    if (c === '(' || c === '[') { depth++; continue }
    if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); continue }
    if (c === '*' && depth === 0) {
      const left = expression.slice(0, i).trim()
      const right = expression.slice(i + 1).trim()
      if (left && right) return [left, right]
    }
  }
  return null
}

// Riconosce espressioni impulso scalate: [coeff*?]delta(t/n [+/- shift])
// Esempi: "delta(t)", "delta(t-2)", "3*delta(t-1)", "2delta(n)", "-delta(t+1)"
function tryParseAsScaledImpulse(expr: string): SignalNode | null {
  const m = expr.match(
    /^([+-]?\d*(?:\.\d+)?)\s*\*?\s*delta\s*\(\s*(?:tau|t|n)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?\s*\)$/i
  )
  if (!m) return null
  const coeffStr = m[1]
  let amplitude: number
  if (coeffStr === '' || coeffStr === '+') amplitude = 1
  else if (coeffStr === '-') amplitude = -1
  else { amplitude = parseFloat(coeffStr); if (isNaN(amplitude)) return null }
  const shift = m[3] ? (m[2] === '-' ? parseFloat(m[3]) : -parseFloat(m[3])) : 0
  return { kind: 'impulse', amplitude, shift }
}

// ─── Parser principale: formula-first ────────────────────────────────────────

export function normalizeSignalInput(expression: string): string {
  return expression
    .replace(/\\pi|π/g, 'π')
    .replace(/\\tau|τ/g, 'tau')
    .replace(/\\omega|ω/g, 'omega')
    .replace(/\\delta|δ/g, 'delta')
    .replace(/\\phi|φ/g, 'phi')
    .replace(/\\theta|θ/g, 'theta')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
}

export function parseSignalExpression(expression: string): ParseResult {
  try {
    const expr = normalizeSignalInput(expression.trim())

    // 1. conv(a, b) esplicito
    if (/^conv\s*\(/i.test(expr)) {
      const args = splitFunctionArgs(expr)
      if (args.length >= 2) {
        const left = parseSignalExpression(args[0])
        const right = parseSignalExpression(args[1])
        if (left.ok && right.ok) {
          return { ok: true, signal: { kind: 'conv', left: left.signal, right: right.signal } }
        }
      }
    }

    // 2. Impulso scalato: [A*]delta(t[-t0])  →  nodo impulse per rendering freccia
    const impulseNode = tryParseAsScaledImpulse(expr)
    if (impulseNode) return { ok: true, signal: impulseNode }

    // 3. a * b al livello 0 → convoluzione (o impulso scalato)
    const starParts = splitTopLevelStar(expr)
    if (starParts) {
      const [leftExpr, rightExpr] = starParts
      const left = parseSignalExpression(leftExpr)
      const right = parseSignalExpression(rightExpr)
      if (left.ok && right.ok) {
        // costante * impulso → impulso scalato
        if (left.signal.kind === 'constant' && right.signal.kind === 'impulse') {
          return { ok: true, signal: { kind: 'impulse', amplitude: left.signal.value * right.signal.amplitude, shift: right.signal.shift } }
        }
        if (left.signal.kind === 'impulse' && right.signal.kind === 'constant') {
          return { ok: true, signal: { kind: 'impulse', amplitude: left.signal.amplitude * right.signal.value, shift: left.signal.shift } }
        }
        // entrambi non-costanti → convoluzione
        if (left.signal.kind !== 'constant' && right.signal.kind !== 'constant') {
          return { ok: true, signal: { kind: 'conv', left: left.signal, right: right.signal } }
        }
        // costante * formula → ricade nel parser formula (moltiplicazione scalare)
      }
    }

    // 4. Espressione matematica generica (gestisce +, -, *, /, ^, funzioni, mul implicita)
    compileFormula(expr)(0)
    return { ok: true, signal: { kind: 'formula', expression: expr } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown parser error' }
  }
}

// ─── Descrive il segnale ──────────────────────────────────────────────────────

export function describeSignal(node: SignalNode): string {
  switch (node.kind) {
    case 'constant': return `Constant ${node.value}`
    case 'formula': return `Formula ${node.expression}`
    case 'sine': return `Sine wave, A=${node.amplitude}, f=${node.frequency}`
    case 'cosine': return `Cosine wave, A=${node.amplitude}, f=${node.frequency}`
    case 'step': return `Unit step shifted at ${node.shift}`
    case 'impulse': return `Impulse centered at ${node.shift}`
    case 'rect': return `Rectangular pulse width ${node.width}`
    case 'triangle': return `Triangular pulse width ${node.width}`
    case 'delay': return `Delayed signal by ${node.amount}`
    case 'sum': return `Sum of ${node.children.length} signals`
    case 'product': return `Product of ${node.children.length} signals`
    case 'conv': return 'Convolution of two signals'
    case 'sgn': return 'Sign function sgn(t)'
    case 'complexExp': return `Complex exponential e^{j(2π·${node.f0}·t + ${node.phi})}`
    case 'periodicExt': return `Periodic extension, T=${node.period}`
    case 'discreteExp': return `Discrete exponential (${node.base})^n`
    case 'rectN': return `Discrete rectangle rect_${node.N}[n]`
    case 'triN': return `Discrete triangle tri_${node.N}[n]`
  }
}

// ─── Formattazione leggibile (variabili fisse: t per CT, n per DT) ────────────

export function formatFormula(node: SignalNode): string {
  const v = 't'
  const d = 'n'
  switch (node.kind) {
    case 'constant': return `x = ${node.value}`
    case 'formula': return `x(${v}) = ${node.expression}`
    case 'sine': return `x(${v}) = ${node.amplitude} sin(2π·${node.frequency}·${v} + ${node.phase})`
    case 'cosine': return `x(${v}) = ${node.amplitude} cos(2π·${node.frequency}·${v} + ${node.phase})`
    case 'step': return `x(${v}) = ${node.height} ε(${v} − ${node.shift})`
    case 'impulse': return `x(${v}) = ${node.amplitude} δ(${v} − ${node.shift})`
    case 'rect': return `x(${v}) = rect((${v}−${node.center})/${node.width})`
    case 'triangle': return `x(${v}) = tri((${v}−${node.center})/${node.width})`
    case 'delay': return `x(${v}) = x(${v} − ${node.amount})`
    case 'sum': return `x(${v}) = Σ xᵢ(${v})`
    case 'product': return `x(${v}) = Π xᵢ(${v})`
    case 'conv': return `y(${v}) = x(${v}) ∗ h(${v})`
    case 'sgn': return `x(${v}) = sgn(${v})`
    case 'complexExp': return `x(${v}) = e^{j(2π·${node.f0}·${v}+${node.phi})}`
    case 'periodicExt': return `x(${v}) = Σ_k p(${v}−k·${node.period})`
    case 'discreteExp': return `x[${d}] = (${node.base})^${d}`
    case 'rectN': return `x[${d}] = rect_{${node.N}}[${d}]`
    case 'triN': return `x[${d}] = tri_{${node.N}}[${d}]`
    default: return `x(${v})`
  }
}

// ─── Valutazione ──────────────────────────────────────────────────────────────

export function evaluateSignal(node: SignalNode, x: number): number {
  switch (node.kind) {
    case 'constant': return node.value
    case 'formula': return compileFormula(node.expression)(x)
    case 'sine': return node.amplitude * Math.sin(2 * Math.PI * node.frequency * x + node.phase) + node.offset
    case 'cosine': return node.amplitude * Math.cos(2 * Math.PI * node.frequency * x + node.phase) + node.offset
    case 'step': {
      const d = x - node.shift
      if (Math.abs(d) < 1e-10) return node.height * 0.5
      return d > 0 ? node.height : 0
    }
    case 'impulse':
      // threshold 0.025 ≈ metà passo tipico (0.02) → almeno 1 campione lo cattura
      return Math.abs(x - node.shift) < 0.025 ? node.amplitude : 0
    case 'rect': {
      const dist = Math.abs(x - node.center)
      const half = node.width / 2
      if (Math.abs(dist - half) < 1e-10) return node.height * 0.5
      return dist < half ? node.height : 0
    }
    case 'triangle': {
      const distance = Math.abs(x - node.center)
      if (distance > node.width / 2) return 0
      return node.height * (1 - distance / (node.width / 2))
    }
    case 'delay': return evaluateSignal(node.child, x - node.amount)
    case 'sum': return node.children.reduce((total, child) => total + evaluateSignal(child, x), 0)
    case 'product': return node.children.reduce((total, child, i) => i === 0 ? evaluateSignal(child, x) : total * evaluateSignal(child, x), 1)
    case 'conv': return approximateConvolution(node.left, node.right, x)
    case 'sgn': return Math.abs(x) < 1e-10 ? 0 : x > 0 ? 1 : -1
    case 'complexExp': return Math.cos(2 * Math.PI * node.f0 * x + node.phi)
    case 'periodicExt': {
      const T = node.period
      if (T <= 0) return 0
      const tMod = ((x % T) + T) % T
      return evaluateSignal(node.prototype, tMod)
    }
    case 'discreteExp': return Math.pow(node.base, Math.round(x))
    case 'rectN': { const n = Math.round(x); return n >= 0 && n < node.N ? 1 : 0 }
    case 'triN': { const n = Math.round(x); if (Math.abs(n) > node.N) return 0; return 1 - Math.abs(n) / node.N }
  }
}

function approximateConvolution(left: SignalNode, right: SignalNode, x: number): number {
  // Proprietà dello sifting: conv(A·δ(t-t₀), g)(x) = A·g(x-t₀)
  if (left.kind === 'impulse') return left.amplitude * evaluateSignal(right, x - left.shift)
  if (right.kind === 'impulse') return right.amplitude * evaluateSignal(left, x - right.shift)

  const step = 0.05
  const limit = 6
  let total = 0
  for (let tau = -limit; tau <= limit; tau += step) {
    total += evaluateSignal(left, tau) * evaluateSignal(right, x - tau) * step
  }
  return total
}

// ─── Estrae posizioni degli impulsi per il rendering freccia ─────────────────

export function extractImpulseMarkers(node: SignalNode): ImpulseMarker[] {
  switch (node.kind) {
    case 'impulse':
      return [{ position: node.shift, amplitude: node.amplitude }]
    case 'sum':
      return node.children.flatMap(extractImpulseMarkers)
    case 'delay':
      return extractImpulseMarkers(node.child).map(m => ({
        position: m.position + node.amount,
        amplitude: m.amplitude,
      }))
    default:
      return []
  }
}

// ─── Campionamento ────────────────────────────────────────────────────────────

export function sampleSignal(node: SignalNode, start: number, end: number, points: number): SignalSample[] {
  const samples: SignalSample[] = []
  const step = (end - start) / Math.max(points - 1, 1)
  for (let i = 0; i < points; i++) {
    const x = start + i * step
    samples.push({ x, y: evaluateSignal(node, x) })
  }
  return samples
}

// ─── Statistiche ─────────────────────────────────────────────────────────────

export function estimateSignalStats(node: SignalNode, samples: SignalSample[]): SignalStats {
  const values = samples.map(s => s.y)
  const peak = Math.max(...values.map(v => Math.abs(v)), 0)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const energy = samples.reduce((total, sample, index, array) => {
    const dt = index === 0 ? 0 : array[index].x - array[index - 1].x
    return total + sample.y * sample.y * Math.abs(dt || 1)
  }, 0)
  const duration = samples[samples.length - 1]?.x - samples[0]?.x || 1
  const averagePower = energy / Math.abs(duration)
  const zeroCrossings = countZeroCrossings(values)
  const estimatedPeriod = detectPeriod(node)
  const estimatedFrequency = estimatedPeriod ? 1 / estimatedPeriod : null
  const classification = energy > 0 && averagePower < 10 ? 'energy' : energy > 0 ? 'power' : 'finite-window'
  return { peak, min, max, energy, averagePower, zeroCrossings, estimatedPeriod, estimatedFrequency, classification }
}

// ─── Rilevamento periodo ──────────────────────────────────────────────────────

export function detectPeriod(node: SignalNode): number | null {
  if (node.kind === 'sine' || node.kind === 'cosine') {
    if (node.frequency === 0) return null
    return 1 / Math.abs(node.frequency)
  }
  if (node.kind === 'complexExp') {
    if (node.f0 === 0) return null
    return 1 / Math.abs(node.f0)
  }
  if (node.kind === 'periodicExt') return node.period
  if (node.kind === 'sum') {
    const periods = node.children.map(detectPeriod).filter((v): v is number => v !== null)
    if (periods.length === 0) return null
    return periods.reduce((a, b) => lcm(a, b))
  }
  if (node.kind === 'formula') {
    // Cerca pattern periodici comuni: sin/cos(2*π*[f0*]t) → T = 1/f0
    const m = node.expression.match(
      /(?:sin|cos)\s*\(\s*2\s*\*?\s*(?:π|pi)\s*\*?\s*(\d*\.?\d*)\s*\*?\s*[tn]/i
    )
    if (m) {
      const f0 = m[1] && m[1] !== '' ? parseFloat(m[1]) : 1
      if (!isNaN(f0) && f0 > 0) return 1 / f0
    }
    return null
  }
  return null
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b)
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b)
  while (y !== 0) { const t = y; y = x % y; x = t }
  return x || 1
}

function countZeroCrossings(values: number[]): number {
  let crossings = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] === 0 || values[i] === 0) continue
    if ((values[i - 1] > 0 && values[i] < 0) || (values[i - 1] < 0 && values[i] > 0)) crossings++
  }
  return crossings
}

// ─── Esempi rapidi ────────────────────────────────────────────────────────────

export function makeExampleSignals(): Array<{ label: string; expression: string }> {
  return [
    { label: 'sin(2πt)', expression: 'sin(2*π*t)' },
    { label: 'rect(t)', expression: 'rect(t)' },
    { label: 'ε(t)', expression: 'step(t)' },
    { label: 'δ[n]', expression: 'delta(n)' },
  ]
}
