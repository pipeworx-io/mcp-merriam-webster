interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Merriam-Webster MCP — wraps the Merriam-Webster Collegiate Dictionary and
 * Collegiate Thesaurus APIs (dictionaryapi.com).
 *
 * The authoritative American English dictionary and thesaurus. Look up word
 * definitions, part of speech, pronunciation, and etymology, or find synonyms
 * and antonyms. When a word isn't found, Merriam-Webster returns close spelling
 * suggestions instead.
 *
 * Tools:
 * - define: definitions, part of speech, pronunciation, etymology for a word
 * - thesaurus: synonyms, antonyms, part of speech, short definitions for a word
 *
 * Dual key model: pass your own Merriam-Webster keys via _apiKey in the form
 * DICT_KEY:THES_KEY for higher limits, or omit it to use the shared Pipeworx
 * keys. Auth: key supplied as the `key` query param.
 */


const BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/collegiate/json';
const THESAURUS_BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/thesaurus/json';

const tools: McpToolExport['tools'] = [
  {
    name: 'define',
    description:
      'Look up a word in the Merriam-Webster dictionary — the authoritative American English dictionary. Returns word definitions (short definitions), part of speech (noun, verb, adjective, etc.), pronunciation, and etymology (word origin). When the word is not found, returns close spelling suggestions instead. Example: define({ word: "ephemeral" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        word: {
          type: 'string',
          description: 'The word to look up, e.g. "ephemeral", "serendipity", "run"',
        },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own Merriam-Webster keys as DICT_KEY:THES_KEY for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: ['word'],
    },
  },
  {
    name: 'thesaurus',
    description:
      'Look up a word in the Merriam-Webster thesaurus — the authoritative American English thesaurus. Returns synonyms and antonyms grouped by sense, along with part of speech (noun, verb, adjective, etc.) and short definitions. When the word is not found, returns close spelling suggestions instead. Example: thesaurus({ word: "happy" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        word: {
          type: 'string',
          description: 'The word to look up, e.g. "happy", "fast", "destroy"',
        },
        _apiKey: {
          type: 'string',
          description:
            'Optional — your own Merriam-Webster keys as DICT_KEY:THES_KEY for higher limits; omit to use the shared Pipeworx key.',
        },
      },
      required: ['word'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const combined = args._apiKey as string | undefined;
  delete args._apiKey;

  const [dictKey, thesKey] = (combined || '').split(':');

  switch (name) {
    case 'define':
      return define(args.word as string, dictKey);
    case 'thesaurus':
      return thesaurus(args.word as string, thesKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Merriam-Webster entry shape (only the fields we surface).
interface MwEntry {
  meta?: { id?: string; stems?: string[]; offensive?: boolean };
  fl?: string; // functional label = part of speech
  hwi?: { prs?: Array<{ mw?: string }> }; // headword info → pronunciations
  shortdef?: string[];
  et?: Array<[string, string]>; // etymology
}

async function define(word: string, apiKey: string) {
  if (!apiKey) {
    return {
      error: 'api_key_required',
      message: 'No Merriam-Webster dictionary key available.',
    };
  }

  if (!word) {
    throw new Error('Merriam-Webster define requires a `word` argument, e.g. define({ word: "ephemeral" }).');
  }

  const url = `${BASE_URL}/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    return { error: res.status, message: text };
  }

  const data = (await res.json()) as unknown[];

  // M-W response quirk: the endpoint returns EITHER
  //   (a) an array of entry objects when the word is found,
  //   (b) an array of plain STRING suggestions when it isn't (close matches), or
  //   (c) an empty array.
  if (!Array.isArray(data) || data.length === 0) {
    return { word, found: false, suggestions: [] as string[] };
  }

  if (typeof data[0] === 'string') {
    return { word, found: false, suggestions: data as string[] };
  }

  const entries = data as MwEntry[];

  return {
    word,
    found: true,
    entries: entries.map((e) => ({
      id: e.meta?.id,
      part_of_speech: e.fl,
      pronunciation: e.hwi?.prs?.[0]?.mw,
      definitions: e.shortdef || [],
      stems: e.meta?.stems,
      etymology: Array.isArray(e.et)
        ? e.et
            .map((x) => x[1])
            .join(' ')
            .replace(/\{[^}]+\}/g, '')
        : undefined,
      offensive: e.meta?.offensive,
    })),
  };
}

// Merriam-Webster thesaurus entry shape (only the fields we surface).
interface MwThesaurusEntry {
  meta?: { id?: string; syns?: string[][]; ants?: string[][] };
  fl?: string; // functional label = part of speech
  shortdef?: string[];
}

async function thesaurus(word: string, apiKey: string) {
  if (!apiKey) {
    return {
      error: 'api_key_required',
      message: 'No Merriam-Webster thesaurus key available.',
    };
  }

  if (!word) {
    throw new Error('Merriam-Webster thesaurus requires a `word` argument, e.g. thesaurus({ word: "happy" }).');
  }

  const url = `${THESAURUS_BASE_URL}/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    return { error: res.status, message: text };
  }

  const data = (await res.json()) as unknown[];

  // Same response quirk as define: the endpoint returns EITHER
  //   (a) an array of entry objects when the word is found,
  //   (b) an array of plain STRING suggestions when it isn't (close matches), or
  //   (c) an empty array.
  if (!Array.isArray(data) || data.length === 0) {
    return { word, found: false, suggestions: [] as string[] };
  }

  if (typeof data[0] === 'string') {
    return { word, found: false, suggestions: data as string[] };
  }

  const entries = data as MwThesaurusEntry[];

  return {
    word,
    found: true,
    entries: entries.map((e) => ({
      id: e.meta?.id,
      part_of_speech: e.fl,
      definitions: e.shortdef || [],
      // meta.syns / meta.ants are arrays-of-arrays of strings — flatten them.
      synonyms: (e.meta?.syns || []).flat(),
      antonyms: (e.meta?.ants || []).flat(),
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
