declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any
  }
}

declare module '*.css'

declare module 'react' {
  export type FormEvent<T = Element> = Event & {
    currentTarget: T
    preventDefault(): void
  }

  export type ReactNode = unknown

  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void
  export function useMemo<T>(factory: () => T, deps: unknown[]): T
  export function useRef<T>(initialValue: T): { current: T }
  export function useState<T>(initialState: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void]

  const React: Record<string, unknown>
  export default React
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): {
    render(node: unknown): void
  }
}

declare module 'react/jsx-runtime' {
  export const Fragment: unknown
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown
}
