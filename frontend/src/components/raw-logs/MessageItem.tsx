import { useState } from 'react';
import { type ClaudeMessage, type ClaudeContentBlock } from '@/lib/api/rawLogs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  ChevronRight, 
  Copy,
  Check,
  Settings
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageItemProps {
  message: ClaudeMessage;
  index: number;
  allMessages?: ClaudeMessage[];
}

export function MessageItem({ message, index, allMessages = [] }: MessageItemProps) {
  // Skip rendering if message only contains tool_result blocks
  if (Array.isArray(message.content)) {
    const hasNonToolResult = message.content.some(block => block.type !== 'tool_result');
    if (!hasNonToolResult) {
      return null;
    }
  }
  

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (text: string, blockIndex: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(blockIndex);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const renderContentBlock = (block: ClaudeContentBlock, blockIndex: number) => {
    if (block.type === 'text') {
      // Check if text looks like code
      const codeMatch = block.text?.match(/^```(\w+)?\n([\s\S]*?)```$/);
      if (codeMatch) {
        const language = codeMatch[1] || 'text';
        const code = codeMatch[2];
        return (
          <div className="relative group">
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleCopy(code, blockIndex)}
            >
              {copiedIndex === blockIndex ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              className="rounded-md text-sm"
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      }
      
      return (
        <div className="whitespace-pre-wrap break-words">
          {block.text}
        </div>
      );
    }

    if (block.type === 'tool_use') {
      // Get tool properties from tool_use
      const toolName = block.tool_use?.name;
      const toolId = block.tool_use?.id;
      const toolInput = block.tool_use?.input;
      
      // Find corresponding tool result
      let toolResult = null;
      if (allMessages && toolId) {
        // Look for tool_result in subsequent messages
        for (let i = index + 1; i < allMessages.length; i++) {
          const nextMessage = allMessages[i];
          if (nextMessage.role === 'user' && Array.isArray(nextMessage.content)) {
            const resultBlock = nextMessage.content.find((b: ClaudeContentBlock) => {
              if (b.type === 'tool_result') {
                const resultToolId = b.tool_result?.tool_use_id;
                return resultToolId === toolId;
              }
              return false;
            });
            if (resultBlock) {
              toolResult = resultBlock;
              break;
            }
          }
        }
      }
      
      return (
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800 rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-sm">Tool Use</span>
              <span className="px-2 py-0.5 text-xs bg-white dark:bg-gray-800 text-foreground rounded border border-gray-200 dark:border-gray-700">
                {toolName}
              </span>
            </div>
            
            <div className="text-xs text-muted-foreground mb-3">
              Tool execution with ID: {toolId}
            </div>
            
            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                Input Parameters
              </summary>
              <div className="mt-2 ml-4">
                <pre className="p-3 bg-white dark:bg-gray-900 rounded-md text-xs overflow-x-auto border border-gray-200 dark:border-gray-700">
                  {JSON.stringify(toolInput, null, 2)}
                </pre>
              </div>
            </details>
            
            {toolResult && (
              <details className="group mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                  Tool Result
                </summary>
                <div className="mt-2 ml-4">
                  {(() => {
                    const content = toolResult.tool_result?.content || '';
                    const lines = content.split('\n');
                    const isLongContent = lines.length > 10 || content.length > 500;
                    
                    if (isLongContent) {
                      return (
                        <pre className="p-3 bg-white dark:bg-gray-900 rounded-md text-xs overflow-x-auto whitespace-pre-wrap border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto">
                          {content}
                        </pre>
                      );
                    } else {
                      return (
                        <pre className="p-3 bg-white dark:bg-gray-900 rounded-md text-xs overflow-x-auto whitespace-pre-wrap border border-gray-200 dark:border-gray-700">
                          {content}
                        </pre>
                      );
                    }
                  })()}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      );
    }

    if (block.type === 'tool_result') {
      // Skip rendering standalone tool_result blocks since they're displayed within tool_use blocks
      return null;
    }

    return null;
  };

  const renderContent = () => {
    if (typeof message.content === 'string') {
      // Check if content looks like code
      const codeMatch = message.content.match(/^```(\w+)?\n([\s\S]*?)```$/);
      if (codeMatch) {
        const language = codeMatch[1] || 'text';
        const code = codeMatch[2];
        return (
          <div className="relative group">
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              onClick={() => handleCopy(code, 0)}
            >
              {copiedIndex === 0 ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
            <SyntaxHighlighter
              language={language}
              style={oneDark}
              className="rounded-md text-sm"
            >
              {code}
            </SyntaxHighlighter>
          </div>
        );
      }
      
      return (
        <div className="whitespace-pre-wrap break-words">
          {message.content}
        </div>
      );
    }

    // Filter out tool_result blocks since they're displayed within tool_use blocks
    const visibleBlocks = message.content.filter(block => block.type !== 'tool_result');
    
    // If no visible blocks remain, return null to skip rendering
    if (visibleBlocks.length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        {visibleBlocks.map((block, blockIndex) => (
          <div key={blockIndex}>
            {renderContentBlock(block, blockIndex)}
          </div>
        ))}
      </div>
    );
  };

  // For user messages, display with gray background and border, aligned right
  if (message.role === 'user') {
    const content = renderContent();
    if (!content) return null;
    
    return (
      <li className="w-full flex justify-end">
        <div className="max-w-3xl lg:max-w-4xl sm:w-[85%] md:w-[80%] px-4 py-2">
          <div className="bg-gray-50 border border-gray-200 dark:bg-gray-900 dark:border-gray-700 rounded-lg p-4">
            {content}
          </div>
        </div>
      </li>
    );
  }

  // For assistant messages, render with the card
  return (
    <li className="w-full">
      <div className="px-4 py-2">
        {renderContent()}
      </div>
    </li>
  );
}