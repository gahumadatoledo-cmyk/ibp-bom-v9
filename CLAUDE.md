# Reglas del proyecto ibp-bom-v9

## Reglas generales de comportamiento

- Yo hablo en español, pero puedes pensar en el idioma que prefieras.
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Suggest running /cost when a session is running long to monitor cache ratio.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done — check for obvious errors and type issues.
- No sycophantic openers or closing fluff. No trailing summaries after tool calls.
- Keep solutions simple and direct. No premature abstractions.
- User instructions always override this file.
- Do not add any changes to the solution until you are at least 90% certain.
- You can ask as many questions as you need until you reach the desired level of certainty.
- No agregar comentarios al código salvo que el WHY sea no obvio.
- No crear archivos de documentación (README, md) salvo que se pida explícitamente.
- Llamar herramientas en paralelo cuando no hay dependencia entre ellas.

## Regla fundamental
**No inventar información nunca.** Si se necesita un dato específico (endpoints, parámetros SOAP, estructura de respuesta, etc.) y no está disponible en el código o en lo que el usuario ha proporcionado, preguntar antes de escribir cualquier cosa.

## Contexto del proyecto
Aplicación web para gestionar y orquestar tasks en sistemas SAP Cloud Integration for data services (CI-DS / HCI) a través de su Web Service SOAP.

## SAP CI-DS — Web Service

### Protocolo
- **SOAP** sobre HTTPS (JAX-WS, WS-I Basic Profile 1.0)
- WSDL: `https://<hci_url>/webservices?wsdl` (Kyma) o `https://<hci_url>/DSoD/webservices?wsdl` (Neo)
- La URL base la configura cada conexión individualmente

### Autenticación
- `logon(orgName, userName, password, isProduction)` → devuelve **SessionID**
- El SessionID va en el **SOAP Header** de todas las operaciones posteriores
- Alternativa: HTTP Basic Auth con headers `Authorization`, `orgName`, `dsodEnv`, `SOAPAction`
- Sesión expira tras 30 min de inactividad, máximo 24 h

### Operaciones disponibles
**Conexión:** `ping`, `logon`, `logout`

**Exploración:**
- `getProjects` → lista proyectos (name, guid)
- `getProjectTasks(projectGuid)` → tasks/processes del proyecto (name, taskGuid, type: TASK|PROCESS)
- `searchTasks(nameFilter)` → busca tasks por nombre
- `getTaskInfo(taskGuid)` → detalle: globalVariables, properties (IBP postprocessing)
- `getAgents(activeOnly)` → agentes con status (CONNECTED/NOT_CONNECTED/MAINTENANCE)
- `getSystemConfigurations` → perfiles/configuraciones del sistema

**Ejecución y monitoreo:**
- `runTask(taskName, agentName?, agentGroup?, profileName?, globalVariables?)` → RunID
- `getTaskStatusByRunId2(runId)` → status, startTime, endTime, uploadBatchInfos
- `getAllExecutedTasks2(taskName?, startDate?, endDate?, statusCode?, version=2.0)` → lista ejecuciones (rango max 90 días)
- `getTaskLogs(runId, traceLog?, monitorLog?, errorLog?)` → logs paginados
- `cancelTask(runId)` → TASK_NOT_STARTED | TASK_FINISHED | TASK_CANCEL_ISSUED

### WSDL — Elementos SOAP reales (document-literal, Neo)
WSDL completo en `docs/service.wsdl`. Namespace: `http://webservices.dsod.sap.com/` (prefijo `web:`).

| Operación               | SOAPAction                        | Body element (web:)              | Headers extra  |
|-------------------------|-----------------------------------|----------------------------------|----------------|
| logon                   | `function=logon`                  | `logonRequest`                   | —              |
| ping                    | `function=ping`                   | `pingRequest`                    | —              |
| logout                  | `function=logoff`                 | `logoutRequest`                  | —              |
| getProjects             | `function=getAllProjects`         | `allProjectsRequest`             | SessionId      |
| getProjectTasks         | `function=getAllProjectTasks`     | `allProjectTasksRequest`         | SessionId      |
| getSystemConfigurations | `function=getAllSystemConfigurations` | `allSystemConfigurationsRequest` | SessionId   |
| getAgents               | `function=getAllAgents`           | `allAgentsRequest`               | SessionId      |
| searchTasks             | `function=searchTasks`            | `searchTasksRequest`             | SessionId      |
| getTaskInfo             | `function=getTaskInfo`            | `taskInfoResponse` (*)           | SessionId      |
| runTask                 | `function=runTask`                | `taskInfo`                       | SessionId      |
| cancelTask              | `function=cancelTask`             | `cancelTaskRequest`               | SessionId      |
| getTaskLogs             | `function=getTaskLogs`            | `taskLogsRequest`                | SessionId      |
| getTaskStatusByRunId2   | `function=getTaskStatusByRunId2`  | `taskStatusRequest`              | SessionId, Version |
| getAllExecutedTasks2     | `function=getAllExecutedTasks2`   | `executedTaskFilterRequest`      | SessionId, Version |

(*) WSDL usa `parts="taskInfoResponse"` en el input — posible typo SAP, confirmar al testear.

### Status codes
`RUNNING`, `SUCCESS`, `SUCCESS_WITH_ERRORS_D`, `SUCCESS_WITH_ERRORS_E`, `ERROR`, `QUEUEING`, `IMPORTED`, `FETCHED`, `TERMINATED`, `TERMINATION_FAILED`, `UNKNOWN`

## Schema de conexión (Redis)
```json
{
  "id": "uuid",
  "name": "nombre visible",
  "color": "#hex",
  "hciUrl": "https://<host>",
  "orgName": "org",
  "user": "usuario",
  "password": "encrypted",
  "isProduction": true
}
```

## Stack técnico
- Frontend: React 19 + Vite 8 + recharts
- Backend: Vercel serverless functions (Node.js 20, ESM)
- Base de datos: Upstash Redis via KV integración Vercel
- Redis key: `cids:connections`
- Passwords encriptadas con AES-256-CBC antes de guardar en Redis
- Las credenciales nunca se envían al frontend — el proxy las resuelve desde Redis

## Archivos clave
- `api/soap.js` — proxy SOAP: recibe `{ connectionId, operation, params }`, construye XML envelope, retorna JSON
- `api/connections.js` — CRUD conexiones en Redis
- `src/components/Connections/` — formulario y lista de conexiones
- `src/components/System/SystemView.jsx` — 3 tabs por conexión
- `src/components/Tasks/TaskMonitor.jsx` — monitor de ejecuciones (getAllExecutedTasks2)
- `src/components/Tasks/Tasks.jsx` — árbol de proyectos + tasks + ejecutar
- `src/components/Resumen/Resumen.jsx` — KPIs y gráficos

## Estructura de tabs por conexión (SystemView)
1. **Resumen** (default) — KPIs de ejecuciones recientes, gráficos, agentes
2. **Projects & Tasks** — árbol getProjects → getProjectTasks + runTask modal
3. **Task Monitor** — tabla getAllExecutedTasks2, filtros fecha/status, cancelar, ver logs

## Convenciones
- Commits sin `Co-Authored-By` para evitar bloqueos en Vercel Hobby
- El proxy SOAP acepta `{ connectionId, operation, params }`; resuelve credenciales desde Redis y gestiona sesión
- Usar `getAllExecutedTasks2` con `version=2.0` (no la versión 1) para obtener todos los status codes
- Fechas en formato ISO 8601 UTC: `2025-03-20T18:30:00Z`
- Sesiones cortas y enfocadas por feature para optimizar consumo de tokens
