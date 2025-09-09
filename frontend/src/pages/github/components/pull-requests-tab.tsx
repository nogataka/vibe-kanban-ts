import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  ExternalLink, 
  GitMerge, 
  GitPullRequest, 
  RefreshCw, 
  X,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { githubApi } from '@/lib/api/github';
import { useToast } from '@/hooks/useToast';

interface PullRequestsTabProps {
  projectId: string;
}

export function PullRequestsTab({ projectId }: PullRequestsTabProps) {
  const [pullRequests, setPullRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [selectedPR, setSelectedPR] = useState<any>(null);
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');
  const [checkingMergeability, setCheckingMergeability] = useState(false);
  const [mergeabilityStatus, setMergeabilityStatus] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadPullRequests();
  }, [projectId]);

  const loadPullRequests = async () => {
    setLoading(true);
    try {
      const data = await githubApi.getPullRequests(projectId, { state: 'open' });
      setPullRequests(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load pull requests',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckMergeability = async (pr: any) => {
    setSelectedPR(pr);
    setCheckingMergeability(true);
    setMergeDialogOpen(true);
    
    try {
      const status = await githubApi.checkMergeability(pr.number);
      setMergeabilityStatus(status);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check mergeability',
        variant: 'destructive',
      });
    } finally {
      setCheckingMergeability(false);
    }
  };

  const handleMergePR = async () => {
    if (!selectedPR) return;
    
    try {
      await githubApi.mergePullRequest(selectedPR.number, {
        merge_method: mergeMethod,
        commit_title: `Merge PR #${selectedPR.number}: ${selectedPR.title}`,
      });
      
      toast({
        title: 'Success',
        description: `Pull request #${selectedPR.number} merged successfully`,
      });
      
      setMergeDialogOpen(false);
      setSelectedPR(null);
      setMergeabilityStatus(null);
      loadPullRequests();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to merge pull request',
        variant: 'destructive',
      });
    }
  };

  const handleClosePR = async (prNumber: number) => {
    try {
      await githubApi.closePullRequest(prNumber);
      toast({
        title: 'Success',
        description: `Pull request #${prNumber} closed`,
      });
      loadPullRequests();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to close pull request',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateBranch = async (prNumber: number) => {
    try {
      await githubApi.updatePullRequestBranch(prNumber);
      toast({
        title: 'Success',
        description: 'Branch updated with base branch',
      });
      loadPullRequests();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update branch',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Pull Requests</h3>
        <Button 
          variant="outline" 
          onClick={loadPullRequests}
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8">Loading pull requests...</div>
      ) : pullRequests.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No open pull requests found
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pullRequests.map((pr) => (
              <TableRow key={pr.number}>
                <TableCell className="font-mono">#{pr.number}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <GitPullRequest className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{pr.title}</span>
                    {pr.draft && (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{pr.user}</TableCell>
                <TableCell>
                  {pr.mergeable === false ? (
                    <div className="flex items-center gap-1 text-orange-600">
                      <AlertCircle className="h-4 w-4" />
                      Conflicts
                    </div>
                  ) : pr.mergeable === true ? (
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      Ready
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unknown</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View
                      </a>
                    </Button>
                    {!pr.draft && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCheckMergeability(pr)}
                        className="flex items-center gap-1"
                      >
                        <GitMerge className="h-3 w-3" />
                        Merge
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUpdateBranch(pr.number)}
                      className="flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Update
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClosePR(pr.number)}
                      className="flex items-center gap-1"
                    >
                      <X className="h-3 w-3" />
                      Close
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Merge Pull Request #{selectedPR?.number}
            </DialogTitle>
            <DialogDescription>
              {selectedPR?.title}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {checkingMergeability ? (
              <div className="text-center py-4">Checking mergeability...</div>
            ) : mergeabilityStatus ? (
              <div className="space-y-4">
                <div className="rounded-lg border p-4">
                  <h4 className="font-medium mb-2">Mergeability Status</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Mergeable:</span>
                      <span className={mergeabilityStatus.mergeable ? 'text-green-600' : 'text-red-600'}>
                        {mergeabilityStatus.mergeable ? 'Yes' : 'No'}
                      </span>
                    </div>
                    {mergeabilityStatus.merge_state_status && (
                      <div className="flex justify-between">
                        <span>State:</span>
                        <span>{mergeabilityStatus.merge_state_status}</span>
                      </div>
                    )}
                    {mergeabilityStatus.required_approving_review_count > 0 && (
                      <div className="flex justify-between">
                        <span>Required Approvals:</span>
                        <span>{mergeabilityStatus.required_approving_review_count}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {mergeabilityStatus.mergeable && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Merge Method</label>
                    <Select value={mergeMethod} onValueChange={(value: any) => setMergeMethod(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="merge">Create merge commit</SelectItem>
                        <SelectItem value="squash">Squash and merge</SelectItem>
                        <SelectItem value="rebase">Rebase and merge</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            {mergeabilityStatus?.mergeable && (
              <Button onClick={handleMergePR}>
                Merge Pull Request
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}