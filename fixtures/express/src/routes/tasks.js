import { API_ROUTES } from "../helpers/permissions.js";

const app = {
  get() {},
  post() {},
  patch() {}
};

function requireUser(_req, _res, next) {
  next();
}

function listTasks(req, res) {
  const status = req.query.status;
  res.json([{ id: "task_1", status }]);
}

function getTask(req, res) {
  res.json({ id: req.params.taskId });
}

function createTask(_req, res) {
  res.status(201).json({ id: "task_2" });
}

function updateTask(req, res) {
  res.json({ id: req.params.taskId, updated: true });
}

app.get(API_ROUTES.listTasks, requireUser, listTasks);
app.get(API_ROUTES.getTask, requireUser, getTask);
app.post("/tasks", requireUser, createTask);
app.patch("/tasks/:taskId", requireUser, updateTask);
