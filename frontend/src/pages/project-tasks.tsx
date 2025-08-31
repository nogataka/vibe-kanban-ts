import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import { projectsApi, tasksApi, attemptsApi } from '@/lib/api';
import { useTaskDialog } from '@/contexts/task-dialog-context';
import { ProjectForm } from '@/components/projects/project-form';
import { TaskTemplateManager } from '@/components/TaskTemplateManager';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts';
import { useSearch } from '@/contexts/search-context';
import { useQuery } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

import {
  getKanbanSectionClasses,
  getMainContainerClasses,
} from '@/lib/responsive-config';

import TaskKanbanBoard from '@/components/tasks/TaskKanbanBoard';
import { TaskDetailsPanel } from '@/components/tasks/TaskDetailsPanel';
import type { TaskWithAttemptStatus, Project, TaskAttempt } from 'shared/types';
import type { DragEndEvent } from '@/components/ui/shadcn-io/kanban';

type Task = TaskWithAttemptStatus;

export function ProjectTasks() {
  const { projectId, taskId, attemptId } = useParams<{
    projectId: string;
    taskId?: string;
    attemptId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { openCreate, openEdit, openDuplicate } = useTaskDialog();
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const { query: searchQuery } = useSearch();

  // Template management state
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);

  // Panel state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Fullscreen state from pathname
  const isFullscreen = location.pathname.endsWith('/full');

  // Attempts fetching (only when task is selected)
  const { data: attempts = [] } = useQuery({
    queryKey: ['taskAttempts', selectedTask?.id],
    queryFn: () => attemptsApi.getAll(selectedTask!.id),
    enabled: !!selectedTask?.id,
  });

  // Selected attempt logic
  const selectedAttempt = useMemo(() => {
    if (!attempts.length) return null;
    if (attemptId) {
      const found = attempts.find((a) => a.id === attemptId);
      if (found) return found;
    }
    return attempts[0] || null; // Most recent fallback
  }, [attempts, attemptId]);

  // Navigation callback for attempt selection
  const setSelectedAttempt = useCallback(
    (attempt: TaskAttempt | null) => {
      if (!selectedTask) return;

      const baseUrl = `/projects/${projectId}/tasks/${selectedTask.id}`;
      const attemptUrl = attempt ? `/attempts/${attempt.id}` : '';
      const fullSuffix = isFullscreen ? '/full' : '';
      const fullUrl = `${baseUrl}${attemptUrl}${fullSuffix}`;

      navigate(fullUrl, { replace: true });
    },
    [navigate, projectId, selectedTask, isFullscreen]
  );

  // Sync selectedTask with URL params
  useEffect(() => {
    if (taskId && tasks.length > 0) {
      const taskFromUrl = tasks.find((t) => t.id === taskId);
      if (taskFromUrl && taskFromUrl !== selectedTask) {
        setSelectedTask(taskFromUrl);
        setIsPanelOpen(true);
      }
    } else if (!taskId && selectedTask) {
      // Clear selection when no taskId in URL
      setSelectedTask(null);
      setIsPanelOpen(false);
    }
  }, [taskId, tasks, selectedTask]);

  // Define task creation handler
  const handleCreateNewTask = useCallback(() => {
    if (!projectId) return;
    openCreate();
  }, [projectId, openCreate]);

  // Full screen

  const fetchProject = useCallback(async () => {
    try {
      const result = await projectsApi.getById(projectId!);
      setProject(result);
    } catch (err) {
      setError('Failed to load project');
    }
  }, [projectId]);

  const handleCloseTemplateManager = useCallback(() => {
    setIsTemplateManagerOpen(false);
  }, []);

  const fetchTasks = useCallback(
    async (skipLoading = false) => {
      try {
        if (!skipLoading) {
          setLoading(true);
        }
        const result = await tasksApi.getAll(projectId!);
        // Only update if data has actually changed
        setTasks((prevTasks) => {
          const newTasks = result;
          if (JSON.stringify(prevTasks) === JSON.stringify(newTasks)) {
            return prevTasks; // Return same reference to prevent re-render
          }

          setSelectedTask((prev) => {
            if (!prev) return prev;

            const updatedSelectedTask = newTasks.find(
              (task) => task.id === prev.id
            );

            if (JSON.stringify(prev) === JSON.stringify(updatedSelectedTask))
              return prev;
            return updatedSelectedTask || prev;
          });

          return newTasks;
        });
      } catch (err) {
        setError('Failed to load tasks');
      } finally {
        if (!skipLoading) {
          setLoading(false);
        }
      }
    },
    [projectId]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (!confirm('Are you sure you want to delete this task?')) return;

      try {
        await tasksApi.delete(taskId);
        await fetchTasks();
      } catch (error) {
        setError('Failed to delete task');
      }
    },
    [fetchTasks]
  );

  const handleEditTask = useCallback(
    (task: Task) => {
      openEdit(task);
    },
    [openEdit]
  );

  const handleDuplicateTask = useCallback(
    (task: Task) => {
      openDuplicate(task);
    },
    [openDuplicate]
  );

  const handleViewTaskDetails = useCallback(
    (task: Task, attemptIdToShow?: string) => {
      // setSelectedTask(task);
      // setIsPanelOpen(true);
      // Update URL to include task ID and optionally attempt ID
      const targetUrl = attemptIdToShow
        ? `/projects/${projectId}/tasks/${task.id}/attempts/${attemptIdToShow}`
        : `/projects/${projectId}/tasks/${task.id}`;
      navigate(targetUrl, { replace: true });
    },
    [projectId, navigate]
  );

  const handleClosePanel = useCallback(() => {
    // setIsPanelOpen(false);
    // setSelectedTask(null);
    // Remove task ID from URL when closing panel
    navigate(`/projects/${projectId}/tasks`, { replace: true });
  }, [projectId, navigate]);

  const handleProjectSettingsSuccess = useCallback(() => {
    setIsProjectSettingsOpen(false);
    fetchProject(); // Refresh project data after settings change
  }, [fetchProject]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || !active.data.current) return;

      const taskId = active.id as string;
      const newStatus = over.id as Task['status'];
      const task = tasks.find((t) => t.id === taskId);

      if (!task || task.status === newStatus) return;

      // Optimistically update the UI immediately
      const previousStatus = task.status;
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );

      try {
        await tasksApi.update(taskId, {
          title: task.title,
          description: task.description,
          status: newStatus,
          parent_task_attempt: task.parent_task_attempt,
          image_ids: null,
        });
      } catch (err) {
        // Revert the optimistic update if the API call failed
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: previousStatus } : t
          )
        );
        setError('Failed to update task status');
      }
    },
    [tasks]
  );

  // Setup keyboard shortcuts
  useKeyboardShortcuts({
    navigate,
    currentPath: window.location.pathname,
    hasOpenDialog: isTemplateManagerOpen || isProjectSettingsOpen,
    closeDialog: () => {}, // No local dialog to close
    onC: handleCreateNewTask,
  });

  // Initialize data when projectId changes
  useEffect(() => {
    if (projectId) {
      fetchProject();
      fetchTasks();

      // Set up polling to refresh tasks every 5 seconds
      const interval = setInterval(() => {
        fetchTasks(true); // Skip loading spinner for polling
      }, 2000);

      // Cleanup interval on unmount
      return () => clearInterval(interval);
    }
  }, [projectId]);

  // Handle direct navigation to task URLs
  useEffect(() => {
    if (taskId && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setSelectedTask((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(task)) return prev;
          return task;
        });
        setIsPanelOpen(true);
      } else {
        // Task not found in current array - refetch to get latest data
        fetchTasks(true);
      }
    } else if (taskId && tasks.length === 0 && !loading) {
      // If we have a taskId but no tasks loaded, fetch tasks
      fetchTasks();
    } else if (!taskId) {
      // Close panel when no taskId in URL
      setIsPanelOpen(false);
      setSelectedTask(null);
    }
  }, [taskId, tasks, loading, fetchTasks]);

  if (loading) {
    return <Loader message="Loading tasks..." size={32} className="py-8" />;
  }

  if (error) {
    return <div className="text-center py-8 text-destructive">{error}</div>;
  }

  return (
    <div
      className={`min-h-full ${getMainContainerClasses(isPanelOpen, isFullscreen)}`}
    >
      {/* Left Column - Kanban Section */}
      <div className={getKanbanSectionClasses(isPanelOpen, isFullscreen)}>
        {tasks.length === 0 ? (
          <div className="max-w-7xl mx-auto mt-8">
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-muted-foreground">
                  No tasks found for this project.
                </p>
                <Button className="mt-4" onClick={handleCreateNewTask}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Task
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="w-full h-full overflow-x-auto">
            <TaskKanbanBoard
              tasks={tasks}
              searchQuery={searchQuery}
              onDragEnd={handleDragEnd}
              onEditTask={handleEditTask}
              onDeleteTask={handleDeleteTask}
              onDuplicateTask={handleDuplicateTask}
              onViewTaskDetails={handleViewTaskDetails}
              isPanelOpen={isPanelOpen}
            />
          </div>
        )}
      </div>

      {/* Right Column - Task Details Panel */}
      {isPanelOpen && (
        <TaskDetailsPanel
          task={selectedTask}
          projectHasDevScript={!!project?.dev_script}
          projectId={projectId!}
          onClose={handleClosePanel}
          onEditTask={handleEditTask}
          onDeleteTask={handleDeleteTask}
          isDialogOpen={isProjectSettingsOpen}
          isFullScreen={isFullscreen}
          setFullScreen={
            selectedAttempt
              ? (fullscreen) => {
                  const baseUrl = `/projects/${projectId}/tasks/${selectedTask!.id}/attempts/${selectedAttempt.id}`;
                  const fullUrl = fullscreen ? `${baseUrl}/full` : baseUrl;
                  navigate(fullUrl, { replace: true });
                }
              : undefined
          }
          selectedAttempt={selectedAttempt}
          attempts={attempts}
          setSelectedAttempt={setSelectedAttempt}
        />
      )}

      {/* Dialogs - rendered at main container level to avoid stacking issues */}

      <ProjectForm
        open={isProjectSettingsOpen}
        onClose={() => setIsProjectSettingsOpen(false)}
        onSuccess={handleProjectSettingsSuccess}
        project={project}
      />

      {/* Template Manager Dialog */}
      <Dialog
        open={isTemplateManagerOpen}
        onOpenChange={setIsTemplateManagerOpen}
      >
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Templates</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <TaskTemplateManager projectId={projectId} />
          </div>
          <DialogFooter>
            <Button onClick={handleCloseTemplateManager}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
