/**
 * Categorical series colors for the dark chart surface: the dataviz
 * reference palette's dark steps, validated as a set against #0f1626
 * (adjacent CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.8, all ≥ 3:1 contrast).
 * Every line also carries a direct text label, so identity never rests on
 * colour alone.
 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const

/** The canvas surface. Symbol fills (source circles) use it to hide the wire behind them. */
export const CANVAS_BG = '#0b111d'

/**
 * Node voltage, lowest to highest: one hue (blue), dark to light on the dark
 * canvas, so higher voltage reads as brighter. Ordinal-validated against
 * CANVAS_BG (monotone lightness, visible steps, darkest step 5.2:1).
 */
export const VOLTAGE_RAMP = ['#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'] as const
