// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import '@/features/settings'
import '@/features/editor'
