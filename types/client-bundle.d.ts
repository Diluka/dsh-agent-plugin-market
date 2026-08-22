export {}

declare global {
  interface Window {
    __ModuleLoader__: {
      load(registration: {
        id: string
        factory(require: (specifier: string) => unknown): Record<string, unknown>
      }): void
    }
  }
}
