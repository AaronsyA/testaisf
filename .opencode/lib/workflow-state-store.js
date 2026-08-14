/* global process */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, dirname, join, relative, resolve } from "node:path"

const SKILLS = {
  "trellis-brainstorm": ["plan", "requirements"],
  "trellis-grill-me": ["plan", "requirements"],
  "trellis-use-case-design": ["plan", "use_case_design"],
  "trellis-before-dev": ["execute", "context_loading"],
  "trellis-break-loop": ["finish", "repair"],
  "trellis-check": ["finish", "quality_check"],
  "trellis-unit-test": ["finish", "testing"],
  "trellis-api-test": ["finish", "testing"],
  "trellis-update-spec": ["finish", "spec_update"],
}

const ROLES = {
  "trellis-research": ["plan", "research"],
  "trellis-implement": ["execute", "implementation"],
  "trellis-check": ["finish", "quality_check"],
  "trellis-unit-test": ["finish", "testing"],
  "trellis-api-test": ["finish", "testing"],
}

const EDIT_TOOLS = new Set(["write", "edit", "apply_patch"])
const SOURCES = new Set(["workflow_status", "skill", "subagent", "tool"])
const PHASES = new Set(["plan", "execute", "finish"])
const STEPS = new Set([
  "task_planning",
  "requirements",
  "use_case_design",
  "research",
  "context_loading",
  "implementation",
  "rework",
  "quality_check",
  "testing",
  "repair",
  "spec_update",
])

function safeContextId(value) {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    value !== "." &&
    value !== ".."
  )
}

function boundedString(value, max = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function validCurrent(value) {
  return (
    value === null ||
    (value &&
      PHASES.has(value.phase) &&
      STEPS.has(value.step) &&
      SOURCES.has(value.source) &&
      (value.role === null || boundedString(value.role)) &&
      boundedString(value.observed_at))
  )
}

function validRole(value) {
  return (
    value &&
    boundedString(value.invocation_id) &&
    Object.hasOwn(ROLES, value.role) &&
    PHASES.has(value.phase) &&
    STEPS.has(value.step) &&
    boundedString(value.started_at)
  )
}

function validTask(value) {
  return value === null || (value && boundedString(value.id) && boundedString(value.status, 64))
}

function validSnapshot(value, contextId) {
  return (
    value &&
    value.schema_version === 1 &&
    value.context_id === contextId &&
    validTask(value.task) &&
    validCurrent(value.current) &&
    (value.activity_active === undefined || typeof value.activity_active === "boolean") &&
    Array.isArray(value.active_roles) &&
    value.active_roles.every(validRole)
  )
}

function normalizeTask(task) {
  if (!task || !boundedString(task.id) || !boundedString(task.status, 64)) {
    return null
  }
  return { id: task.id, status: task.status }
}

export class WorkflowStateStore {
  constructor(directory, options = {}) {
    this.directory = resolve(directory)
    this.enabled = options.enabled === true && safeContextId(options.contextId)
    this.contextId = this.enabled ? options.contextId : null
    this.now = options.now || (() => new Date())
    this.filePath = this.enabled
      ? join(directory, ".trellis", ".runtime", "workflow-state", `${this.contextId}.json`)
      : null
  }

  syncTask(task) {
    if (!this.filePath) return
    const nextTask = normalizeTask(task)
    const state = this.read()

    if (!nextTask) {
      if (state?.task !== null) {
        this.write(this.emptyState())
      }
      return
    }

    if (!state || state.task?.id !== nextTask.id) {
      const next = this.emptyState()
      next.task = nextTask
      this.write(next)
      return
    }

    const statusChanged = state.task.status !== nextTask.status
    state.task = nextTask
    const hadLegacyFallback = state.current?.source === "workflow_status"
    if (hadLegacyFallback) {
      state.current = null
      state.activity_active = false
      state.active_roles = []
    }
    if (hadLegacyFallback || statusChanged) {
      this.write(state)
    }
  }

  observeSkill(name) {
    this.setCurrent(SKILLS[name], "skill")
  }

  startRole(invocationId, role) {
    if (!this.filePath || !boundedString(invocationId) || !Object.hasOwn(ROLES, role)) return
    const state = this.read()
    if (!state?.task) return
    const [phase, step] = ROLES[role]
    const startedAt = this.timestamp()
    state.active_roles = state.active_roles.filter(active => active.invocation_id !== invocationId)
    state.active_roles.push({
      invocation_id: invocationId,
      role,
      phase,
      step,
      started_at: startedAt,
    })
    state.current = {
      phase,
      step,
      source: "subagent",
      role,
      observed_at: startedAt,
    }
    state.activity_active = true
    this.write(state)
  }

  finishRole(invocationId) {
    if (!this.filePath || !boundedString(invocationId)) return
    const state = this.read()
    if (!state) return
    const remaining = state.active_roles.filter(active => active.invocation_id !== invocationId)
    if (remaining.length === state.active_roles.length) return
    state.active_roles = remaining

    const latest = remaining.at(-1)
    if (latest) {
      state.current = {
        phase: latest.phase,
        step: latest.step,
        source: "subagent",
        role: latest.role,
        observed_at: this.timestamp(),
      }
    } else if (state.current) {
      state.current.role = null
      state.current.observed_at = this.timestamp()
      state.activity_active = false
    }
    this.write(state)
  }

  observeTool(name, args = {}) {
    if (!EDIT_TOOLS.has(name)) return
    const state = this.read()
    if (state?.task?.status !== "in_progress") return
    const activeFinishRole = [...state.active_roles].reverse().find(role => role.phase === "finish")
    if (activeFinishRole) {
      state.current = {
        phase: activeFinishRole.phase,
        step: activeFinishRole.step,
        source: "subagent",
        role: activeFinishRole.role,
        observed_at: this.timestamp(),
      }
      state.activity_active = true
      this.write(state)
      return
    }
    if (state.current?.phase === "finish") {
      const target = [args.filePath, args.file_path, args.path].find(value => typeof value === "string")
      if (!target) return
      const targetPath = relative(this.directory, resolve(this.directory, target)).replaceAll("\\", "/")
      if (
        targetPath === ".." ||
        targetPath.startsWith("../") ||
        targetPath === ".trellis" ||
        targetPath.startsWith(".trellis/") ||
        targetPath === ".opencode" ||
        targetPath.startsWith(".opencode/")
      ) return
      this.setCurrent(["finish", "repair"], "tool", state)
      return
    }
    this.setCurrent(["execute", "implementation"], "tool", state)
  }

  deactivateActivity() {
    if (!this.filePath) return
    const state = this.read()
    if (!state || (!state.activity_active && state.active_roles.length === 0)) return
    state.activity_active = false
    state.active_roles = []
    if (state.current) state.current.role = null
    this.write(state)
  }

  setCurrent(mapping, source, state = this.read()) {
    if (!mapping || !state?.task) return
    const [phase, step] = mapping
    state.current = {
      phase,
      step,
      source,
      role: null,
      observed_at: this.timestamp(),
    }
    state.activity_active = true
    this.write(state)
  }

  emptyState() {
    return {
      schema_version: 1,
      context_id: this.contextId,
      task: null,
      current: null,
      activity_active: false,
      active_roles: [],
    }
  }

  timestamp() {
    return this.now().toISOString()
  }

  read() {
    if (!this.filePath || !existsSync(this.filePath)) return null
    try {
      const value = JSON.parse(readFileSync(this.filePath, "utf-8"))
      return validSnapshot(value, this.contextId)
        ? { ...value, activity_active: value.activity_active === true }
        : null
    } catch {
      return null
    }
  }

  write(state) {
    if (!this.filePath) return
    const stateDir = dirname(this.filePath)
    mkdirSync(stateDir, { recursive: true })
    const tempPath = join(stateDir, `.${basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
      // ponytail: atomic last-writer-wins is enough while one OpenCode process owns a context;
      // add per-context locking only if multiple processes are allowed to share one context ID.
      renameSync(tempPath, this.filePath)
    } finally {
      if (existsSync(tempPath)) unlinkSync(tempPath)
    }
  }
}
