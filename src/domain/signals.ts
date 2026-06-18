export type ViewMode = 'time' | 'discrete' | 'frequency'

export type NotationSettings = {
  timeVariable: 't' | 'tau'
  discreteVariable: 'n' | 'k'
  frequencyVariable: 'f' | 'omega'
}

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
  | {
      kind: 'constant'
      value: number
    }
  | {
      kind: 'formula'
      expression: string
    }
  | {
      kind: 'sine'
      amplitude: number
      frequency: number
      phase: number
      offset: number
    }
  | {
      kind: 'cosine'
      amplitude: number
      frequency: number
      phase: number
      offset: number
    }
  | {
      kind: 'step'
      height: number
      shift: number
    }
  | {
      kind: 'impulse'
      amplitude: number
      shift: number
    }
  | {
      kind: 'rect'
      width: number
      height: number
      center: number
    }
  | {
      kind: 'triangle'
      width: number
      height: number
      center: number
    }
  | {
      kind: 'delay'
      amount: number
      child: SignalNode
    }
  | {
      kind: 'sum'
      children: SignalNode[]
    }
  | {
      kind: 'product'
      children: SignalNode[]
    }
  | {
      kind: 'conv'
      left: SignalNode
      right: SignalNode
    }
  // --- Segnali elementari continui aggiuntivi del corso ---
  | {
      kind: 'sgn'  // sgn(t) = 2ε(t) - 1 (con sgn(0)=0)
    }
  | {
      kind: 'complexExp'  // Re{e^{j(2πf₀t+φ)}} = cos(2πf₀t+φ)
      f0: number
      phi: number
    }
  | {
      kind: 'periodicExt'  // Estensione periodica: p(t) = Σ_k p₀(t - kT)
      prototype: SignalNode
      period: number
    }
  // --- Segnali elementari discreti aggiuntivi del corso ---
  | {
      kind: 'discreteExp'  // a^n (reale), utile con ε[n]: a^n * step(1,0)
      base: number
    }
  | {
      kind: 'rectN'  // rect_N[n] = 1 per 0 ≤ n < N, 0 altrimenti
      N: number
    }
  | {
      kind: 'triN'   // tri_N[n] = 1 - |n/N| per |n| ≤ N, 0 altrimenti
      N: number
    }

export type ParseResult =
  | {
      ok: true
      signal: SignalNode
    }
  | {
      ok: false
      error: string
    }

export type SignalSample = {
  x: number
  y: number
}

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

const TOKEN_REGEX = /\s*(\\pi|π|[A-Za-z_][A-Za-z0-9_]*|\d*\.\d+|\d+|\+|-|\*|\/|\^|\(|\)|\[|\]|,)/gy

class Parser {
  private readonly tokens: string[]
  private index = 0

  constructor(expression: string) {
    this.tokens = tokenize(expression)
  }

  parse(): SignalNode {
    const node = this.parseSum()
    if (!this.isAtEnd()) {
      throw new Error(`Unexpected token: ${this.peek()}`)
    }
    return node
  }

  private parseSum(): SignalNode {
    const terms: SignalNode[] = [this.parseProduct()]

    while (this.match('+')) {
      terms.push(this.parseProduct())
    }

    return terms.length === 1 ? terms[0] : { kind: 'sum', children: terms }
  }

  private parseProduct(): SignalNode {
    const factors: SignalNode[] = [this.parseUnary()]

    while (true) {
      if (this.match('*')) {
        factors.push(this.parseUnary())
        continue
      }

      if (this.isImplicitProductStart(this.peek())) {
        factors.push(this.parseUnary())
        continue
      }

      break
    }

    return factors.length === 1 ? factors[0] : { kind: 'product', children: factors }
  }

  private parseUnary(): SignalNode {
    if (this.match('-')) {
      return {
        kind: 'product',
        children: [{ kind: 'sine', amplitude: -1, frequency: 0, phase: 0, offset: 0 }, this.parseUnary()],
      }
    }

    return this.parsePrimary()
  }

  private parsePrimary(): SignalNode {
    if (this.match('(')) {
      const node = this.parseSum()
      this.consume(')')
      return node
    }

    const token = this.peek()
    if (isNumberToken(token)) {
      this.advance()
      return { kind: 'constant', value: Number(token) }
    }

    if (isPiToken(token)) {
      this.advance()
      return { kind: 'constant', value: Math.PI }
    }

    if (isIdentifierToken(token)) {
      const name = token?.toLowerCase() ?? ''
      this.advance()
      if (this.match('(')) {
        const args = this.parseArguments()
        this.consume(')')

        if (name === 'x' && args.length === 1) {
          return toSignalNode(args[0])
        }

        return buildNode(name, args)
      }

      if (name === 'pi' || name === 'π') {
        return { kind: 'constant', value: Math.PI }
      }

      if (name === 'e') {
        return { kind: 'constant', value: Math.E }
      }
    }

    throw new Error(`Unexpected token: ${token ?? 'end of input'}`)
  }

  private parseArguments(): SignalNode[] | number[] {
    const items: Array<SignalNode | number> = []

    if (this.match(')')) {
      this.index -= 1
      return items as number[]
    }

    while (true) {
      items.push(this.parseArgument())
      if (!this.match(',')) {
        break
      }
    }

    return items as number[]
  }

  private parseArgument(): SignalNode | number {
    const token = this.peek()

    if (token === '(' || token === '[') {
      return this.parsePrimary()
    }

    if (isNumberToken(token)) {
      this.advance()
      return Number(token)
    }

    if (isPiToken(token)) {
      this.advance()
      return Math.PI
    }

    if (isIdentifierToken(token)) {
      const next = this.peek(1)
      if (next === '(') {
        return this.parsePrimary()
      }

      const name = token?.toLowerCase() ?? ''
      if (name === 'pi' || name === 'e') {
        this.advance()
        return name === 'pi' ? Math.PI : Math.E
      }
    }

    throw new Error(`Invalid argument: ${token ?? 'end of input'}`)
  }

  private match(expected: string): boolean {
    if (this.peek() !== expected) {
      return false
    }
    this.index += 1
    return true
  }

  private consume(expected: string): void {
    if (!this.match(expected)) {
      throw new Error(`Expected '${expected}' but found '${this.peek() ?? 'end of input'}'`)
    }
  }

  private peek(offset = 0): string | undefined {
    return this.tokens[this.index + offset]
  }

  private advance(): void {
    this.index += 1
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length
  }

  private isImplicitProductStart(token: string | undefined): boolean {
    return token === '(' || isNumberToken(token) || isIdentifierToken(token)
  }
}

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

function isPiToken(token: string | undefined): boolean {
  return token === 'π' || token === 'pi'
}

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
  step: (value) => (value >= 0 ? 1 : 0),
  u: (value) => (value >= 0 ? 1 : 0),
  rect: (value, width = 1) => (Math.abs(value) <= width / 2 ? 1 : 0),
  tri: (value, width = 1) => {
    const distance = Math.abs(value)
    if (distance > width / 2) {
      return 0
    }
    return 1 - distance / (width / 2)
  },
  delta: (value) => (Math.abs(value) < 1e-9 ? 1 : 0),
  // sinc normalizzato: sinc(t) = sin(πt)/(πt), sinc(0) = 1 (def. corso Dalai)
  sinc: (value) => (Math.abs(value) < 1e-9 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value)),
  // sgn(t) = +1 per t>0, 0 per t=0, -1 per t<0
  sgn: (value) => (Math.abs(value) < 1e-10 ? 0 : value > 0 ? 1 : -1),
}

const formulaCache = new Map<string, (x: number) => number>()

class FormulaParser {
  private readonly tokens: string[]
  private index = 0

  constructor(expression: string) {
    this.tokens = tokenize(expression)
  }

  parse(): number {
    const value = this.parseSum()
    if (!this.isAtEnd()) {
      throw new Error(`Unexpected token: ${this.peek()}`)
    }
    return value
  }

  private parseSum(): number {
    let value = this.parseProduct()

    while (this.match('+') || this.match('-')) {
      const operator = this.previous()
      const right = this.parseProduct()
      value = operator === '+' ? value + right : value - right
    }

    return value
  }

  private parseProduct(): number {
    let value = this.parsePower()

    while (true) {
      if (this.match('*')) {
        value *= this.parsePower()
        continue
      }

      if (this.match('/')) {
        const divisor = this.parsePower()
        value = divisor === 0 ? 0 : value / divisor
        continue
      }

      if (this.isImplicitProductStart(this.peek())) {
        value *= this.parsePower()
        continue
      }

      break
    }

    return value
  }

  private parsePower(): number {
    let value = this.parseUnary()

    if (this.match('^')) {
      const exponent = this.parsePower()
      value = Math.pow(value, exponent)
    }

    return value
  }

  private parseUnary(): number {
    if (this.match('+')) {
      return this.parseUnary()
    }

    if (this.match('-')) {
      return -this.parseUnary()
    }

    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.peek()

    if (isNumberToken(token)) {
      this.advance()
      return Number(token)
    }

    if (isPiToken(token)) {
      this.advance()
      return Math.PI
    }

    if (isIdentifierToken(token)) {
      const name = (token ?? '').toLowerCase()
      this.advance()

      if (this.match('(')) {
        const args: number[] = []
        if (!this.match(')')) {
          do {
            args.push(this.parseSum())
          } while (this.match(','))

          this.consume(')')
        }

        if (name === 'x' && args.length === 1) {
          return args[0]
        }

        return this.evaluateFunction(name, args)
      }

      if (name === 'x' || name === 't' || name === 'tau' || name === 'n' || name === 'k' || name === 'f' || name === 'omega') {
        return this.scopeValue(name)
      }

      if (name === 'pi' || name === 'π') {
        return Math.PI
      }

      if (name === 'e') {
        return Math.E
      }

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
      if (args.length === 1) {
        return args[0]
      }

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

  private readonly scope: Record<string, number> = {
    x: 0,
    t: 0,
    tau: 0,
    n: 0,
    k: 0,
    f: 0,
    omega: 0,
    a: 1,
    b: 1,
    phi: 0,
    theta: 0,
    delta: 0,
    phi0: 0,
    t0: 0,
    a0: 1,
    b0: 1,
  }

  private match(expected: string): boolean {
    if (this.peek() !== expected) {
      return false
    }

    this.index += 1
    return true
  }

  private consume(expected: string): void {
    if (!this.match(expected)) {
      throw new Error(`Expected '${expected}' but found '${this.peek() ?? 'end of input'}'`)
    }
  }

  private peek(offset = 0): string | undefined {
    return this.tokens[this.index + offset]
  }

  private previous(): string | undefined {
    return this.tokens[this.index - 1]
  }

  private advance(): void {
    this.index += 1
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length
  }

  private isImplicitProductStart(token: string | undefined): boolean {
    return token === '(' || isNumberToken(token) || isIdentifierToken(token) || isPiToken(token)
  }
}

function toSignalNode(value: SignalNode | number): SignalNode {
  if (typeof value === 'number') {
    return { kind: 'constant', value }
  }

  return value
}

function compileFormula(expression: string): (x: number) => number {
  const cached = formulaCache.get(expression)
  if (cached) {
    return cached
  }

  const evaluator = (x: number) => {
    const parser = new FormulaParser(expression)
    parser['scope'].x = x
    parser['scope'].t = x
    parser['scope'].tau = x
    parser['scope'].n = x
    parser['scope'].k = x
    parser['scope'].f = x
    parser['scope'].omega = x
    return parser.parse()
  }

  formulaCache.set(expression, evaluator)
  return evaluator
}

function looksStructuredExpression(expression: string): boolean {
  return /^(sine|cosine|step|impulse|rect|triangle|delay|sum|product|conv|sgn|complexexp|periodicext|discreteexp|rectn|trin)\s*\(/i.test(expression)
}

function splitTopLevelConvolution(expression: string): [string, string] | null {
  let depth = 0

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]

    if (character === '(' || character === '[') {
      depth += 1
      continue
    }

    if (character === ')' || character === ']') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (character === '*' && depth === 0) {
      const left = expression.slice(0, index).trim()
      const right = expression.slice(index + 1).trim()
      if (left && right) {
        return [left, right]
      }
    }
  }

  return null
}

function isNumberToken(token: string | undefined): boolean {
  return typeof token === 'string' && (/^\d*\.\d+$/.test(token) || /^\d+$/.test(token))
}

function isIdentifierToken(token: string | undefined): boolean {
  return typeof token === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token)
}

function asNumber(value: SignalNode | number): number {
  if (typeof value === 'number') {
    return value
  }

  if (value.kind === 'constant') {
    return value.value
  }

  if (value.kind === 'sine' && value.frequency === 0 && value.phase === 0 && value.offset === 0) {
    return value.amplitude
  }

  throw new Error('Expected a numeric parameter')
}

function asSignal(value: SignalNode | number): SignalNode {
  if (typeof value === 'number') {
    return { kind: 'constant', value }
  }

  return value
}

function buildNode(name: string, args: Array<SignalNode | number>): SignalNode {
  switch (name) {
    case 'sine':
      return {
        kind: 'sine',
        amplitude: asNumber(args[0] ?? 1),
        frequency: asNumber(args[1] ?? 1),
        phase: asNumber(args[2] ?? 0),
        offset: asNumber(args[3] ?? 0),
      }
    case 'cosine':
      return {
        kind: 'cosine',
        amplitude: asNumber(args[0] ?? 1),
        frequency: asNumber(args[1] ?? 1),
        phase: asNumber(args[2] ?? 0),
        offset: asNumber(args[3] ?? 0),
      }
    case 'step':
      return {
        kind: 'step',
        height: asNumber(args[0] ?? 1),
        shift: asNumber(args[1] ?? 0),
      }
    case 'impulse':
      return {
        kind: 'impulse',
        amplitude: asNumber(args[0] ?? 1),
        shift: asNumber(args[1] ?? 0),
      }
    case 'rect':
      return {
        kind: 'rect',
        width: asNumber(args[0] ?? 2),
        height: asNumber(args[1] ?? 1),
        center: asNumber(args[2] ?? 0),
      }
    case 'triangle':
      return {
        kind: 'triangle',
        width: asNumber(args[0] ?? 2),
        height: asNumber(args[1] ?? 1),
        center: asNumber(args[2] ?? 0),
      }
    case 'delay':
      return {
        kind: 'delay',
        child: asSignal(args[0] ?? { kind: 'step', height: 1, shift: 0 }),
        amount: asNumber(args[1] ?? 0),
      }
    case 'sum':
      return {
        kind: 'sum',
        children: args.map(asSignal),
      }
    case 'product':
      return {
        kind: 'product',
        children: args.map(asSignal),
      }
    case 'conv':
      return {
        kind: 'conv',
        left: asSignal(args[0] ?? { kind: 'step', height: 1, shift: 0 }),
        right: asSignal(args[1] ?? { kind: 'step', height: 1, shift: 0 }),
      }
    case 'sgn':
      return { kind: 'sgn' }
    case 'complexexp':
      return {
        kind: 'complexExp',
        f0: asNumber(args[0] ?? 1),
        phi: asNumber(args[1] ?? 0),
      }
    case 'periodicext':
      return {
        kind: 'periodicExt',
        prototype: asSignal(args[0] ?? { kind: 'constant', value: 0 }),
        period: asNumber(args[1] ?? 1),
      }
    case 'discreteexp':
      return {
        kind: 'discreteExp',
        base: asNumber(args[0] ?? 0.5),
      }
    case 'rectn':
      return {
        kind: 'rectN',
        N: Math.max(1, Math.round(asNumber(args[0] ?? 4))),
      }
    case 'trin':
      return {
        kind: 'triN',
        N: Math.max(1, Math.round(asNumber(args[0] ?? 4))),
      }
    default:
      throw new Error(`Unknown signal kind: ${name}`)
  }
}

export function parseSignalExpression(expression: string): ParseResult {
  try {
    const normalizedExpression = normalizeSignalInput(expression.trim())

    if (looksStructuredExpression(normalizedExpression)) {
      const parser = new Parser(normalizedExpression)
      return { ok: true, signal: parser.parse() }
    }

    const convolutionParts = splitTopLevelConvolution(normalizedExpression)
    if (convolutionParts) {
      const [leftExpression, rightExpression] = convolutionParts
      const left = parseSignalExpression(leftExpression)
      const right = parseSignalExpression(rightExpression)

      if (left.ok && right.ok && (left.signal.kind !== 'constant' || right.signal.kind !== 'constant')) {
        return {
          ok: true,
          signal: {
            kind: 'conv',
            left: left.signal,
            right: right.signal,
          },
        }
      }
    }

    compileFormula(normalizedExpression)(0)
    return { ok: true, signal: { kind: 'formula', expression: normalizedExpression } }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown parser error',
    }
  }
}

export function describeSignal(node: SignalNode): string {
  switch (node.kind) {
    case 'constant':
      return `Constant ${node.value}`
    case 'formula':
      return `Formula ${node.expression}`
    case 'sine':
      return `Sine wave, A=${node.amplitude}, f=${node.frequency}`
    case 'cosine':
      return `Cosine wave, A=${node.amplitude}, f=${node.frequency}`
    case 'step':
      return `Unit step shifted at ${node.shift}`
    case 'impulse':
      return `Impulse centered at ${node.shift}`
    case 'rect':
      return `Rectangular pulse width ${node.width}`
    case 'triangle':
      return `Triangular pulse width ${node.width}`
    case 'delay':
      return `Delayed signal by ${node.amount}`
    case 'sum':
      return `Sum of ${node.children.length} signals`
    case 'product':
      return `Product of ${node.children.length} signals`
    case 'conv':
      return 'Convolution of two signals'
    case 'sgn':
      return 'Sign function sgn(t)'
    case 'complexExp':
      return `Complex exponential e^{j(2π·${node.f0}·t + ${node.phi})}`
    case 'periodicExt':
      return `Periodic extension, T=${node.period}`
    case 'discreteExp':
      return `Discrete exponential (${node.base})^n`
    case 'rectN':
      return `Discrete rectangle rect_${node.N}[n]`
    case 'triN':
      return `Discrete triangle tri_${node.N}[n]`
  }
}

export function evaluateSignal(node: SignalNode, x: number): number {
  switch (node.kind) {
    case 'constant':
      return node.value
    case 'formula':
      return compileFormula(node.expression)(x)
    case 'sine':
      return node.amplitude * Math.sin(2 * Math.PI * node.frequency * x + node.phase) + node.offset
    case 'cosine':
      return node.amplitude * Math.cos(2 * Math.PI * node.frequency * x + node.phase) + node.offset
    case 'step': {
      // ε(t): 1 per t > shift, 1/2 per t = shift (def. corso Dalai), 0 per t < shift
      const d = x - node.shift
      if (Math.abs(d) < 1e-10) return node.height * 0.5
      return d > 0 ? node.height : 0
    }
    case 'impulse':
      return Math.abs(x - node.shift) < 1e-3 ? node.amplitude : 0
    case 'rect': {
      // rect(t): 1 per |t-c|<w/2, 1/2 per |t-c|=w/2, 0 altrimenti (def. corso Dalai)
      const dist = Math.abs(x - node.center)
      const half = node.width / 2
      if (Math.abs(dist - half) < 1e-10) return node.height * 0.5
      return dist < half ? node.height : 0
    }
    case 'triangle': {
      // tri(t): 1 - |t-c|/(w/2) per |t-c| ≤ w/2, 0 altrimenti
      const distance = Math.abs(x - node.center)
      if (distance > node.width / 2) {
        return 0
      }
      const factor = 1 - distance / (node.width / 2)
      return node.height * factor
    }
    case 'delay':
      return evaluateSignal(node.child, x - node.amount)
    case 'sum':
      return node.children.reduce((total, child) => total + evaluateSignal(child, x), 0)
    case 'product':
      return node.children.reduce((total, child, index) => (index === 0 ? evaluateSignal(child, x) : total * evaluateSignal(child, x)), 1)
    case 'conv':
      return approximateConvolution(node.left, node.right, x)
    // --- Segnali aggiuntivi del corso ---
    case 'sgn':
      // sgn(t) = 2ε(t) - 1: +1 per t>0, 0 per t=0, -1 per t<0
      if (Math.abs(x) < 1e-10) return 0
      return x > 0 ? 1 : -1
    case 'complexExp':
      // Parte reale di e^{j(2πf₀t+φ)} = cos(2πf₀t+φ)
      return Math.cos(2 * Math.PI * node.f0 * x + node.phi)
    case 'periodicExt': {
      // Riduce t al range fondamentale [0, T) e valuta il prototipo
      const T = node.period
      if (T <= 0) return 0
      let tMod = ((x % T) + T) % T
      return evaluateSignal(node.prototype, tMod)
    }
    case 'discreteExp':
      // a^n — diverge per |a|>1, utile moltiplicato per ε[n]
      return Math.pow(node.base, Math.round(x))
    case 'rectN': {
      // rect_N[n] = 1 per 0 ≤ n < N, 0 altrimenti
      const n = Math.round(x)
      return n >= 0 && n < node.N ? 1 : 0
    }
    case 'triN': {
      // tri_N[n] = 1 - |n/N| per |n| ≤ N, 0 altrimenti
      const n = Math.round(x)
      if (Math.abs(n) > node.N) return 0
      return 1 - Math.abs(n) / node.N
    }
  }
}

function approximateConvolution(left: SignalNode, right: SignalNode, x: number): number {
  const step = 0.05
  const limit = 6
  let total = 0

  for (let tau = -limit; tau <= limit; tau += step) {
    total += evaluateSignal(left, tau) * evaluateSignal(right, x - tau) * step
  }

  return total
}

export function sampleSignal(node: SignalNode, start: number, end: number, points: number): SignalSample[] {
  const samples: SignalSample[] = []
  const step = (end - start) / Math.max(points - 1, 1)

  for (let index = 0; index < points; index += 1) {
    const x = start + index * step
    samples.push({ x, y: evaluateSignal(node, x) })
  }

  return samples
}

export function estimateSignalStats(node: SignalNode, samples: SignalSample[]): SignalStats {
  const values = samples.map((sample) => sample.y)
  const peak = Math.max(...values.map((value) => Math.abs(value)), 0)
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

  return {
    peak,
    min,
    max,
    energy,
    averagePower,
    zeroCrossings,
    estimatedPeriod,
    estimatedFrequency,
    classification,
  }
}

export function formatFormula(node: SignalNode, notation: NotationSettings): string {
  const variable = notation.timeVariable
  const discrete = notation.discreteVariable
  const frequency = notation.frequencyVariable

  switch (node.kind) {
    case 'constant':
      return `x = ${node.value}`
    case 'formula':
      return `x(${variable}) = ${node.expression}`
    case 'sine':
      return `x(${variable}) = ${node.amplitude} sin(2π ${frequency} ${variable} + ${node.phase}) + ${node.offset}`
    case 'cosine':
      return `x(${variable}) = ${node.amplitude} cos(2π ${frequency} ${variable} + ${node.phase}) + ${node.offset}`
    case 'step':
      return `x(${variable}) = ${node.height} u(${variable} - ${node.shift})`
    case 'impulse':
      return `x(${variable}) = ${node.amplitude} δ(${variable} - ${node.shift})`
    case 'rect':
      return `x(${variable}) = rect(${variable} - ${node.center}, width=${node.width})`
    case 'triangle':
      return `x(${variable}) = tri(${variable} - ${node.center}, width=${node.width})`
    case 'delay':
      return `x(${variable}) = x(${variable} - ${node.amount})`
    case 'sum':
      return `x(${variable}) = Σ x_i(${variable})`
    case 'product':
      return `x(${variable}) = Π x_i(${variable})`
    case 'conv':
      return `y(${variable}) = x(${variable}) * h(${variable})`
    case 'sgn':
      return `x(${variable}) = sgn(${variable})`
    case 'complexExp':
      return `x(${variable}) = e^{j(2π·${node.f0}·${variable} + ${node.phi})}`
    case 'periodicExt':
      return `x(${variable}) = Σ_k p(${variable} - k·${node.period})`
    case 'discreteExp':
      return `x[${discrete}] = (${node.base})^${discrete}`
    case 'rectN':
      return `x[${discrete}] = rect_{${node.N}}[${discrete}]`
    case 'triN':
      return `x[${discrete}] = tri_{${node.N}}[${discrete}]`
    default:
      return `x(${discrete})`
  }
}

function detectPeriod(node: SignalNode): number | null {
  if (node.kind === 'sine' || node.kind === 'cosine') {
    if (node.frequency === 0) {
      return null
    }
    return 1 / Math.abs(node.frequency)
  }

  if (node.kind === 'sum') {
    const periods = node.children.map(detectPeriod).filter((value): value is number => Boolean(value))
    if (periods.length === 0) {
      return null
    }
    return periods.reduce((left, right) => lcm(left, right))
  }

  return null
}

function lcm(left: number, right: number): number {
  return Math.abs(left * right) / gcd(left, right)
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)

  while (b !== 0) {
    const temp = b
    b = a % b
    a = temp
  }

  return a || 1
}

function countZeroCrossings(values: number[]): number {
  let crossings = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === 0 || values[index] === 0) {
      continue
    }
    if ((values[index - 1] > 0 && values[index] < 0) || (values[index - 1] < 0 && values[index] > 0)) {
      crossings += 1
    }
  }
  return crossings
}

export function makeExampleSignals(): Array<{ label: string; expression: string }> {
  return [
    { label: 'Sinusoid', expression: 'sine(1,1,0,0)' },
    { label: 'Step + sine', expression: 'step(1,0) + sine(0.5,2,0,0)' },
    { label: 'Pulse train', expression: 'rect(2,1,0) + rect(2,0.5,4)' },
    { label: 'Delayed pulse', expression: 'delay(rect(2,1,0),2)' },
  ]
}
