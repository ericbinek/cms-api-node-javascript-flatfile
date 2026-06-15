// Compiled access policy for this target, derived from the project-wide access/
// authority (roles.json, field-access.json, workflow.json). Pure data plus pure
// helpers — no IO, no request handling. The router and server enforce it.

const POLICY = {
  "operations": [
    "read",
    "create",
    "update",
    "delete"
  ],
  "roles": {
    "admin": {
      "description": "Full access to every entity plus account management.",
      "matrix": {
        "*": [
          "read",
          "create",
          "update",
          "delete"
        ]
      },
      "accountManagement": true
    },
    "editor": {
      "description": "Full CRUD on every entity. Drives the publication workflow.",
      "matrix": {
        "*": [
          "read",
          "create",
          "update",
          "delete"
        ]
      }
    },
    "author": {
      "description": "Reads and creates every entity, but updates and deletes only own records.",
      "matrix": {
        "*": [
          "read",
          "create",
          "update",
          "delete"
        ]
      },
      "ownership": {
        "scope": "own",
        "operations": [
          "update",
          "delete"
        ],
        "field": "createdBy"
      }
    },
    "viewer": {
      "description": "Authenticated read only across every entity, including non public status.",
      "matrix": {
        "*": [
          "read"
        ]
      }
    },
    "anonymous": {
      "description": "Unauthenticated read, no session. Restricted to publicly visible records via the read visibility rule.",
      "matrix": {
        "*": [
          "read"
        ]
      },
      "read": {
        "visibility": "public"
      }
    }
  },
  "visibility": {
    "description": "Read visibility scopes a role read rule can reference. \"all\" returns every record, so reads stay backward compatible with the current auth free API. \"public\" restricts status bearing entities to their public states defined in access/workflow.json, and where a datePublished property exists it must be reached; entities without a status enum stay fully readable either way. Which scope the anonymous role ships with at rollout is the open decision for the API auth block, see docs/auth/implementation-plan.md.",
    "scopes": [
      "all",
      "public"
    ]
  },
  "fieldGroups": {
    "system": [
      "id",
      "dateCreated",
      "dateModified"
    ],
    "internal": [
      "createdBy"
    ]
  },
  "fieldRules": {
    "*": {
      "read": {
        "deny": [
          "@internal"
        ]
      },
      "write": {
        "deny": [
          "@system",
          "@internal"
        ]
      }
    }
  },
  "workflow": {
    "BlogPosting": {
      "statusProperty": "creativeWorkStatus",
      "initial": "Draft",
      "public": [
        "Published"
      ],
      "transitions": [
        {
          "from": "Draft",
          "to": "Pending",
          "roles": [
            "author",
            "editor",
            "admin"
          ]
        },
        {
          "from": "Pending",
          "to": "Draft",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Pending",
          "to": "Published",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Published",
          "to": "Archived",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Archived",
          "to": "Published",
          "roles": [
            "editor",
            "admin"
          ]
        }
      ],
      "hasPublishDate": true
    },
    "WebPage": {
      "statusProperty": "creativeWorkStatus",
      "initial": "Draft",
      "public": [
        "Published"
      ],
      "transitions": [
        {
          "from": "Draft",
          "to": "Pending",
          "roles": [
            "author",
            "editor",
            "admin"
          ]
        },
        {
          "from": "Pending",
          "to": "Draft",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Pending",
          "to": "Published",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Published",
          "to": "Archived",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Archived",
          "to": "Published",
          "roles": [
            "editor",
            "admin"
          ]
        }
      ],
      "hasPublishDate": true
    },
    "Comment": {
      "statusProperty": "creativeWorkStatus",
      "initial": "Pending",
      "public": [
        "Approved"
      ],
      "transitions": [
        {
          "from": "Pending",
          "to": "Approved",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Pending",
          "to": "Spam",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Approved",
          "to": "Spam",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Approved",
          "to": "Trash",
          "roles": [
            "editor",
            "admin"
          ]
        },
        {
          "from": "Spam",
          "to": "Trash",
          "roles": [
            "editor",
            "admin"
          ]
        }
      ],
      "hasPublishDate": false
    }
  }
};

const ROLES = POLICY.roles;
const WORKFLOW = POLICY.workflow;
const SYSTEM_FIELDS = new Set(POLICY.fieldGroups.system);
const INTERNAL_FIELDS = new Set(POLICY.fieldGroups.internal);
const FIELD_RULES = POLICY.fieldRules;

// Resolves a role's field rule for a mode (read/write) into a concrete deny set,
// expanding the group references @system and @internal. A per-role rule wins over
// the "*" default. "deny" wins; an absent rule denies nothing.
function denySet(role, mode) {
  const byRole = FIELD_RULES[role] && FIELD_RULES[role][mode];
  const byDefault = FIELD_RULES['*'] && FIELD_RULES['*'][mode];
  const rule = byRole || byDefault || {};
  const deny = new Set();
  for (const entry of rule.deny || []) {
    if (entry === '@system') for (const f of SYSTEM_FIELDS) deny.add(f);
    else if (entry === '@internal') for (const f of INTERNAL_FIELDS) deny.add(f);
    else deny.add(entry);
  }
  return deny;
}

// The fields no client may ever write (system + internal), i.e. the default
// write deny resolved. Exposed for request builders and tests.
export const READONLY_FIELDS = denySet('*', 'write');

// Type-level: may `role` perform `op` on `entity`? A per-entity matrix entry
// overrides the "*" default for that entity only.
export function can(role, entity, op) {
  const r = ROLES[role];
  if (!r || !r.matrix) return false;
  const ops = Object.prototype.hasOwnProperty.call(r.matrix, entity) ? r.matrix[entity] : r.matrix['*'];
  return Array.isArray(ops) && ops.includes(op);
}

// Ownership: the owner field name if `role` is restricted to its own records for
// `op` (e.g. author update/delete -> "createdBy"), else null.
export function ownershipField(role, op) {
  const own = ROLES[role] && ROLES[role].ownership;
  if (!own || !own.operations.includes(op)) return null;
  return own.field;
}

export function isGoverned(entity) {
  return Object.prototype.hasOwnProperty.call(WORKFLOW, entity);
}

export function statusProperty(entity) {
  return isGoverned(entity) ? WORKFLOW[entity].statusProperty : null;
}

export function initialStatus(entity) {
  return isGoverned(entity) ? WORKFLOW[entity].initial : null;
}

// May `role` move `entity` from `from` to `to`? Non-governed entities and no-op
// transitions (from === to) are always allowed; everything else must be modelled.
export function transitionAllowed(entity, from, to, role) {
  if (!isGoverned(entity)) return true;
  if (from === to) return true;
  return WORKFLOW[entity].transitions.some(
    (t) => t.from === from && t.to === to && t.roles.includes(role),
  );
}

// Field-level write: the names in `body` a `role` is not allowed to set (system
// and internal fields). Any hit is a 400, not a silent drop.
export function readonlyViolations(role, body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  const deny = denySet(role, 'write');
  return Object.keys(body).filter((k) => deny.has(k));
}

// Field-level read: strip denied (internal) fields from a value before it leaves
// the server, recursing into arrays and embedded objects so embeds are covered.
export function stripFields(role, value) {
  const deny = denySet(role, 'read');
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (deny.has(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

// On create the server stamps ownership (createdBy) and forces the workflow entry
// state, overriding any client-supplied status.
export function applyCreateDefaults(entity, data, accountId) {
  const out = { ...data, createdBy: accountId };
  const initial = initialStatus(entity);
  if (initial !== null) out[statusProperty(entity)] = initial;
  return out;
}

// Anonymous read visibility: "public" gates status-bearing entities to their
// public states (and a reached datePublished where the entity has one); "all"
// returns every record. Internal fields are stripped under either scope.
function readVisibility(role) {
  const r = ROLES[role];
  return (r && r.read && r.read.visibility) || 'all';
}

export function isVisible(role, entity, item) {
  if (readVisibility(role) !== 'public') return true;
  if (!isGoverned(entity)) return true;
  const wf = WORKFLOW[entity];
  if (!wf.public.includes(item[wf.statusProperty])) return false;
  if (wf.hasPublishDate) {
    const published = item.datePublished;
    if (typeof published !== 'string') return false;
    const at = Date.parse(published);
    if (Number.isNaN(at) || at > Date.now()) return false;
  }
  return true;
}
