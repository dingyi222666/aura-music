type Handler = (e: KeyboardEvent) => boolean | void; // return true to stop propagation

interface Listener {
  id: string;
  priority: number;
  handler: Handler;
}

class KeyboardRegistry {
  private listeners: Listener[] = [];

  register(id: string, handler: Handler, priority: number) {
    // Remove existing if re-registering with same ID
    this.unregister(id);
    this.listeners.push({ id, handler, priority });
    // Sort descending by priority
    this.listeners.sort((a, b) => b.priority - a.priority);
  }

  unregister(id: string) {
    this.listeners = this.listeners.filter((l) => l.id !== id);
  }

  handle(e: KeyboardEvent) {
    // Iterate through listeners by priority
    for (const listener of this.listeners) {
      // If a handler returns true, it claims the event
      if (listener.handler(e) === true) {
        e.stopPropagation();
        // We don't prevent default globally here to allow browser defaults like F5,
        // unless the specific handler calls e.preventDefault()
        return;
      }
    }
  }
}

export const keyboardRegistry = new KeyboardRegistry();
