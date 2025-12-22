export type Listener<EventType> = (event_: EventType) => void

export type UnsubscribeFunction = () => void

/**
 * createObserver
 *
 * @returns observer
 */
export const createObserver = <EventType = void>(): {
  subscribe: (listener: Listener<EventType>) => UnsubscribeFunction
  publish: (event: EventType) => void
} => {
  let listeners: Listener<EventType>[] = []
  return {
    publish: (event: EventType) => {
      for (const l of listeners) l(event)
    },
    subscribe: (listener: Listener<EventType>): UnsubscribeFunction => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    },
  }
}
/**
 * createLiteObserver is a helper function that creates a listener that can be
 * only listens'ed to once at a time and you cannot unsubscribe.
 *
 * @returns observer
 */
export const createLiteObserver = <EventType = void>(): {
  subscribe: (listener: Listener<EventType>) => void
  publish: (event: EventType) => void
} => {
  let currentListener: Listener<EventType> | undefined
  return {
    publish: (event: EventType) => {
      if (currentListener) {
        currentListener(event)
      }
    },
    subscribe: (listener: Listener<EventType>): void => {
      currentListener = listener
    },
  }
}
