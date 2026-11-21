// In-app navigation stack tracker (module state). Lets the back arrow decide
// between router.back() (keeps scroll) and a deterministic push to the parent.
const stack: string[] = [];

export const ROOT_ROUTES = ["/", "/meetings", "/login"] as const;

// Direction comes from popstate (history back/forward), not path inference, so
// a forward push A -> B -> A is not mistaken for "back".
let popped = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    popped = true;
  });
}

export function recordPath(p: string): void {
  const viaPop = popped;
  popped = false;
  if (stack[stack.length - 1] === p) return;
  if (viaPop && stack.length >= 2 && stack[stack.length - 2] === p) {
    stack.pop();
    return;
  }
  stack.push(p);
  if (stack.length > 50) stack.shift();
}

export function previousPath(): string | null {
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}

export function parentOf(pathname: string): string {
  return pathname === "/meeting" || pathname.startsWith("/meetings/") ? "/meetings" : "/";
}

export function navBack(router: { back(): void; push(href: string): void }, parent: string): void {
  if (previousPath() === parent) router.back();
  else router.push(parent);
}
