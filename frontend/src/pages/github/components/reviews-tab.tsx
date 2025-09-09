import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { githubApi } from '@/lib/api/github';
import { useToast } from '@/hooks/useToast';

interface ReviewsTabProps {
  projectId: string;
}

export function ReviewsTab({ projectId: _projectId }: ReviewsTabProps) {
  const [prNumber, setPrNumber] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewEvent, setReviewEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT');
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreateReview = async () => {
    if (!prNumber) {
      toast({
        title: 'Error',
        description: 'Please enter a PR number',
        variant: 'destructive',
      });
      return;
    }

    try {
      await githubApi.createPRReview(parseInt(prNumber), {
        body: reviewBody,
        event: reviewEvent,
      });
      
      toast({
        title: 'Success',
        description: 'Review created successfully',
      });
      
      setReviewBody('');
      loadReviews(parseInt(prNumber));
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create review',
        variant: 'destructive',
      });
    }
  };

  const loadReviews = async (pr: number) => {
    setLoading(true);
    try {
      const data = await githubApi.getPRReviews(pr);
      setReviews(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load reviews',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getReviewIcon = (state: string) => {
    switch (state) {
      case 'APPROVED':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'CHANGES_REQUESTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <MessageSquare className="h-4 w-4 text-blue-600" />;
    }
  };

  const getReviewBadge = (state: string) => {
    switch (state) {
      case 'APPROVED':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'CHANGES_REQUESTED':
        return <Badge className="bg-red-100 text-red-800">Changes Requested</Badge>;
      case 'COMMENTED':
        return <Badge className="bg-blue-100 text-blue-800">Commented</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      default:
        return <Badge>{state}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Create Review Section */}
      <Card>
        <CardHeader>
          <CardTitle>Create Review</CardTitle>
          <CardDescription>
            Submit a review for a pull request
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">PR Number</label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Enter PR number"
                value={prNumber}
                onChange={(e) => {
                  setPrNumber(e.target.value);
                  if (e.target.value) {
                    loadReviews(parseInt(e.target.value));
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Review Type</label>
              <Select value={reviewEvent} onValueChange={(value: any) => setReviewEvent(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMENT">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Comment
                    </div>
                  </SelectItem>
                  <SelectItem value="APPROVE">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Approve
                    </div>
                  </SelectItem>
                  <SelectItem value="REQUEST_CHANGES">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Request Changes
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Review Comment</label>
            <Textarea
              placeholder="Write your review comment..."
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              rows={4}
            />
          </div>
          
          <Button 
            onClick={handleCreateReview}
            disabled={!prNumber}
            className="w-full"
          >
            Submit Review
          </Button>
        </CardContent>
      </Card>

      {/* Reviews List */}
      {prNumber && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Reviews for PR #{prNumber}
              {loading && <span className="text-sm text-muted-foreground">Loading...</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reviews.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No reviews found for this PR
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div key={review.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getReviewIcon(review.state)}
                        <span className="font-medium">{review.user}</span>
                        {getReviewBadge(review.state)}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {new Date(review.submitted_at).toLocaleDateString()}
                      </span>
                    </div>
                    {review.body && (
                      <p className="text-sm mt-2 whitespace-pre-wrap">{review.body}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Text */}
      {!prNumber && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
              <h3 className="font-medium">Get Started</h3>
              <p className="text-sm text-muted-foreground">
                Enter a PR number above to view and create reviews
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}