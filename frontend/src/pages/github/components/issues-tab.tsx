import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, ExternalLink, MessageCircle } from 'lucide-react';
import { githubApi } from '@/lib/api/github';
import { useToast } from '@/hooks/useToast';

interface IssuesTabProps {
  projectId: string;
}

export function IssuesTab({ projectId }: IssuesTabProps) {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newIssue, setNewIssue] = useState({
    title: '',
    body: '',
    labels: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    loadIssues();
  }, [projectId]);

  const loadIssues = async () => {
    setLoading(true);
    try {
      const data = await githubApi.getIssues(projectId, { state: 'open' });
      setIssues(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load issues',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIssue = async () => {
    try {
      const labels = newIssue.labels
        ? newIssue.labels.split(',').map(l => l.trim())
        : undefined;
      
      await githubApi.createIssue(projectId, {
        title: newIssue.title,
        body: newIssue.body,
        labels,
      });
      
      toast({
        title: 'Success',
        description: 'Issue created successfully',
      });
      
      setCreateDialogOpen(false);
      setNewIssue({ title: '', body: '', labels: '' });
      loadIssues();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create issue',
        variant: 'destructive',
      });
    }
  };

  const handleCloseIssue = async (issueNumber: number) => {
    try {
      await githubApi.updateIssue(issueNumber, { state: 'closed' });
      toast({
        title: 'Success',
        description: 'Issue closed successfully',
      });
      loadIssues();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to close issue',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Open Issues</h3>
        <Button 
          className="flex items-center gap-2"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Issue
        </Button>
      </div>
      
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[625px]">
            <DialogHeader>
              <DialogTitle>Create New Issue</DialogTitle>
              <DialogDescription>
                Create a new issue in your GitHub repository
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newIssue.title}
                  onChange={(e) => setNewIssue({ ...newIssue, title: e.target.value })}
                  placeholder="Issue title"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="body">Description</Label>
                <Textarea
                  id="body"
                  value={newIssue.body}
                  onChange={(e) => setNewIssue({ ...newIssue, body: e.target.value })}
                  placeholder="Describe the issue..."
                  rows={5}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="labels">Labels (comma-separated)</Label>
                <Input
                  id="labels"
                  value={newIssue.labels}
                  onChange={(e) => setNewIssue({ ...newIssue, labels: e.target.value })}
                  placeholder="bug, enhancement, documentation"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateIssue} disabled={!newIssue.title}>
                Create Issue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {loading ? (
        <div className="text-center py-8">Loading issues...</div>
      ) : issues.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No open issues found
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Labels</TableHead>
              <TableHead className="w-[100px]">Comments</TableHead>
              <TableHead className="w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((issue) => (
              <TableRow key={issue.number}>
                <TableCell className="font-mono">#{issue.number}</TableCell>
                <TableCell className="font-medium">{issue.title}</TableCell>
                <TableCell>{issue.user}</TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {issue.labels?.map((label: string) => (
                      <Badge key={label} variant="secondary">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" />
                    {issue.comments || 0}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCloseIssue(issue.number)}
                    >
                      Close
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}