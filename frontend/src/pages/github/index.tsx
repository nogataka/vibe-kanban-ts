import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Github, GitPullRequest, MessageSquare, CircleAlert, ArrowLeft } from 'lucide-react';
import { IssuesTab } from './components/issues-tab';
import { PullRequestsTab } from './components/pull-requests-tab';
import { ReviewsTab } from './components/reviews-tab';

export function GitHubManagementPage() {
  const [activeTab, setActiveTab] = useState('issues');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get('project_id');

  useEffect(() => {
    if (!projectId) {
      // Redirect to projects page if no project is selected
      navigate('/projects');
    }
  }, [projectId, navigate]);

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <Link to={`/projects/${projectId}/tasks`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tasks
          </Button>
        </Link>
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Github className="h-8 w-8" />
          GitHub Management
        </h1>
        <p className="text-muted-foreground">
          Manage Issues, Pull Requests, and Reviews for your GitHub repository
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
          <TabsTrigger value="issues" className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4" />
            Issues
          </TabsTrigger>
          <TabsTrigger value="pull-requests" className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            Pull Requests
          </TabsTrigger>
          <TabsTrigger value="reviews" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Reviews
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Issues</CardTitle>
              <CardDescription>
                Create, view, and manage GitHub issues
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IssuesTab projectId={projectId!} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pull-requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pull Requests</CardTitle>
              <CardDescription>
                View and manage pull requests, merge branches
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PullRequestsTab projectId={projectId!} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reviews" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Reviews</CardTitle>
              <CardDescription>
                Manage code reviews and comments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReviewsTab projectId={projectId!} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}