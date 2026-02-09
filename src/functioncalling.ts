type ToolAction = {
  type: 'tool';
  name: string | null;
  args: Record<string, unknown> | null;
  user_text?: string | null;
};

export type ToolConfig = {
  name: string;
  module: string; // e.g. './function/test.ts'
  export?: string; // named export; if omitted, use default
};

const toolModules = import.meta.glob('./function/*.ts');
let configPromise: Promise<ToolConfig[]> | null = null;

async function loadConfig(): Promise<ToolConfig[]> {
  if (configPromise) return configPromise;
  const fallback: { tools: ToolConfig[] } = { tools: [] };
  configPromise = fetch('/functioncalling.json')
    .then(res => (res.ok ? (res.json() as Promise<{ tools: ToolConfig[] }>) : Promise.resolve(fallback)))
    .then((data): ToolConfig[] => data.tools)
    .catch((): ToolConfig[] => []);
  return configPromise;
}

export async function runTool(action: ToolAction) {
  if (!action.name) return null;
  const configs = await loadConfig();
  const cfg = configs.find(c => c.name === action.name);
  if (!cfg) {
    console.warn('tool not found in config: ${action.name}');
    return null;
  }

  const loader = toolModules[cfg.module];
  if (!loader) {
    console.warn('module not found for tool: ${cfg.module}');
    return null;
  }

  const mod = (await loader()) as Record<string, unknown>;
  const fn = (cfg.export ? mod[cfg.export] : mod.default) as
    | ((args: unknown) => unknown | Promise<unknown>)
    | undefined;

  if (typeof fn !== 'function') {
    console.warn('export not found or not a function for tool: ${cfg.name}');
    return null;
  }

  const payload = { args: action.args ?? null, user_text: action.user_text ?? null };
  return fn(payload);
}
