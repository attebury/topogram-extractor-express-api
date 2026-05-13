export const API_ROUTES = {
  listTasks: "/tasks",
  getTask: "/tasks/:taskId"
};

export const permissions = new Map();
permissions.set(API_ROUTES.listTasks, { authenticated: true });
permissions.set(API_ROUTES.getTask, { authenticated: true, super: true });
