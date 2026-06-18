// Macro-aree del corso Segnali e Sistemi (Prof. Dalai, UniBS)
// A: FT continua aperiodica  B: FS + spettro Dirac  C: DTFT  D: DTFT periodico  E: DFT

export type AnalysisMode =
  | 'CT_aperiodic'  // A: X(f) = ∫ x(t) e^{-j2πft} dt
  | 'CT_periodic'   // B: X_k = (1/T) ∫₀ᵀ p(t) e^{-j2π(k/T)t} dt
  | 'DT_aperiodic'  // C: X(f) = Σ x[n] e^{-j2πfn}, f ∈ [-1/2, 1/2)
  | 'DT_periodic'   // D: X_k = (1/N) Σ x[n] e^{-j2πkn/N}
  | 'DT_DFT'        // E: X[k] = Σ x[n] e^{-j2πkn/N}, N punti

export type Complex = { re: number; im: number }

// Spettro continuo — CT aperiodico (A) e DT aperiodico (C)
export type ContinuousSpectrum = {
  kind: 'continuous'
  frequencies: Float64Array  // asse f
  magnitude: Float64Array    // |X(f)|
  phase: Float64Array        // ∠X(f) radianti
}

// Spettro a impulsi di Dirac — CT periodico (B) e DT periodico (D)
export type DiracSpectrum = {
  kind: 'dirac'
  T: number                  // periodo T (CT) oppure N (DT)
  k: number[]                // indici armonici
  frequencies: number[]      // k/T oppure k/N
  magnitude: number[]        // |X_k|
  phase: number[]            // ∠X_k
  envelope?: {               // Inviluppo continuo (1/T)|P(f)| dalla relazione di Poisson
    frequencies: Float64Array
    magnitude: Float64Array
  }
}

// DFT N-point (E): frequenze normalizzate k/N
export type DFTSpectrum = {
  kind: 'dft'
  N: number
  k: number[]
  frequencies: number[]      // k/N ∈ [0, 1)
  magnitude: number[]
  phase: number[]
}

export type SpectralResult = ContinuousSpectrum | DiracSpectrum | DFTSpectrum

export type AnalysisParams = {
  period?: number        // T per Motore B (CT_periodic)
  kMax?: number          // numero armoniche FS (default 15)
  dftN?: number          // N punti per Motore E (default 64)
  fMin?: number          // override asse f (Motore A)
  fMax?: number
  gibbsEnabled?: boolean
  gibbsHarmonics?: number
  samplingFc?: number    // fc [Hz] per overlay aliasing
}
