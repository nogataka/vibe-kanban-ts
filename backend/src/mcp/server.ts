import { WebSocketServer, WebSocket } from 'ws';
import { DeploymentService } from '../services/deployment';
import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class MCPServer {
  private wss?: WebSocketServer;
  private deployment: DeploymentService;
  private db: DatabaseService;

  constructor(deployment: DeploymentService, db: DatabaseService) {
    this.deployment = deployment;
    this.db = db;
  }

  async initialize(): Promise<void> {
    const port = parseInt(process.env.MCP_PORT || '9999', 10);
    
    this.wss = new WebSocketServer({ port });
    
    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('MCP client connected');
      
      ws.on('message', async (data: Buffer) => {
        try {
          const request: MCPRequest = JSON.parse(data.toString());
          const response = await this.handleRequest(request);
          ws.send(JSON.stringify(response));
        } catch (error: any) {
          logger.error('MCP request error:', error);
          const errorResponse: MCPResponse = {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal error',
              data: error.message
            }
          };
          ws.send(JSON.stringify(errorResponse));
        }
      });

      ws.on('close', () => {
        logger.info('MCP client disconnected');
      });
    });

    logger.info(`MCP server listening on port ${port}`);
  }

  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id);
      
      case 'tools/list':
        return this.handleToolsList(id);
      
      case 'tools/call':
        return this.handleToolCall(params, id);
      
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
    }
  }

  private handleInitialize(id?: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'vibe-kanban-mcp',
          version: '1.0.0'
        }
      }
    };
  }

  private handleToolsList(id?: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'list_projects',
            description: 'List all projects',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'list_tasks',
            description: 'List tasks for a project',
            inputSchema: {
              type: 'object',
              properties: {
                project_id: {
                  type: 'string',
                  description: 'Project ID'
                }
              }
            }
          },
          {
            name: 'create_task',
            description: 'Create a new task',
            inputSchema: {
              type: 'object',
              properties: {
                project_id: {
                  type: 'string',
                  description: 'Project ID'
                },
                title: {
                  type: 'string',
                  description: 'Task title'
                },
                description: {
                  type: 'string',
                  description: 'Task description'
                }
              },
              required: ['project_id', 'title']
            }
          },
          {
            name: 'update_task',
            description: 'Update a task',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'Task ID'
                },
                title: {
                  type: 'string',
                  description: 'New title'
                },
                description: {
                  type: 'string',
                  description: 'New description'
                },
                status: {
                  type: 'string',
                  enum: ['todo', 'inprogress', 'done', 'cancelled', 'inreview'],
                  description: 'Task status'
                }
              },
              required: ['task_id']
            }
          },
          {
            name: 'execute_task',
            description: 'Execute a task with an AI agent',
            inputSchema: {
              type: 'object',
              properties: {
                task_id: {
                  type: 'string',
                  description: 'Task ID'
                },
                executor: {
                  type: 'string',
                  description: 'Executor name (e.g., claude-3-5-sonnet-latest)'
                }
              },
              required: ['task_id']
            }
          }
        ]
      }
    };
  }

  private async handleToolCall(params: any, id?: string | number): Promise<MCPResponse> {
    const { name, arguments: args } = params;

    try {
      let result: any;

      switch (name) {
        case 'list_projects':
          result = await this.listProjects();
          break;
        
        case 'list_tasks':
          result = await this.listTasks(args.project_id);
          break;
        
        case 'create_task':
          result = await this.createTask(args.project_id, args.title, args.description);
          break;
        
        case 'update_task':
          result = await this.updateTask(args.task_id, args);
          break;
        
        case 'execute_task':
          result = await this.executeTask(args.task_id, args.executor);
          break;
        
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      };
    } catch (error: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error.message
        }
      };
    }
  }

  private async listProjects() {
    const conn = this.db.getConnection();
    const projects = await conn('projects').select('*').orderBy('created_at', 'desc');
    return projects;
  }

  private async listTasks(projectId?: string) {
    const tasks = await this.deployment.getTasks(projectId);
    return tasks;
  }

  private async createTask(projectId: string, title: string, description?: string) {
    const task = await this.deployment.createTask(projectId, title, description);
    return task;
  }

  private async updateTask(taskId: string, updates: any) {
    const { title, description, status } = updates;
    const task = await this.deployment.updateTask(taskId, {
      title,
      description,
      status
    });
    return task;
  }

  private async executeTask(taskId: string, executor?: string) {
    await this.deployment.updateTask(taskId, { status: 'inprogress' });
    
    return {
      message: 'Task execution started',
      task_id: taskId,
      executor: executor || 'default'
    };
  }

  async shutdown(): Promise<void> {
    if (this.wss) {
      this.wss.close();
    }
  }
}