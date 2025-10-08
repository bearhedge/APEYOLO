import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle } from "lucide-react";
import type { RiskRules } from "@shared/schema";

const DEFAULT_RULES_YAML = `# Orca Options Risk Rules Configuration
trading_parameters:
  spy_0dte:
    delta_range:
      min: 0.10
      max: 0.30
    min_open_interest: 100
    max_spread_width: 10.0
    max_contracts_per_trade: 5
    
  weekly_singles:
    delta_range:
      min: 0.15
      max: 0.35
    min_open_interest: 50
    max_spread_width: 15.0
    max_contracts_per_trade: 3

risk_limits:
  portfolio_delta_limit: 2.50
  max_margin_utilization: 0.80
  max_position_size: 10000.00
  
  symbol_limits:
    SPY: 20
    TSLA: 5
    AAPL: 5
    NVDA: 3
    AMZN: 3

validation_rules:
  require_margin_check: true
  require_delta_check: true
  require_oi_check: true
  allow_override: false

market_conditions:
  trading_hours_only: true
  exclude_earnings_week: true
  max_vix_threshold: 30.0`;

export default function Rules() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rulesText, setRulesText] = useState('');
  const [isValid, setIsValid] = useState(true);

  const { data: rules = [] } = useQuery<RiskRules[]>({
    queryKey: ['/api/rules'],
  });

  // Effect to set rules text when data loads
  React.useEffect(() => {
    if (rules.length > 0 && rulesText === '') {
      const defaultRules = rules.find((r: any) => r.name === 'default');
      if (defaultRules) {
        setRulesText(formatConfigAsYaml(defaultRules.config));
      }
    }
  }, [rules, rulesText]);

  const saveRulesMutation = useMutation({
    mutationFn: async (yamlContent: string) => {
      try {
        // Parse YAML content (basic validation)
        const config = parseYamlContent(yamlContent);
        
        return apiRequest('POST', '/api/rules', {
          name: 'default',
          config,
          isActive: true
        });
      } catch (error) {
        throw new Error('Invalid YAML format');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rules'] });
      toast({
        title: "Rules Saved",
        description: "Risk rules have been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save rules. Please check your YAML syntax.",
        variant: "destructive",
      });
    },
  });

  const handleSaveRules = () => {
    if (isValid) {
      saveRulesMutation.mutate(rulesText);
    }
  };

  const handleResetRules = () => {
    setRulesText(DEFAULT_RULES_YAML);
    setIsValid(true);
  };

  const handleRulesChange = (value: string) => {
    setRulesText(value);
    // Basic validation - in a real app, use a proper YAML parser
    try {
      parseYamlContent(value);
      setIsValid(true);
    } catch {
      setIsValid(false);
    }
  };

  // Simple YAML-like parser for this demo
  function parseYamlContent(yamlText: string) {
    // This is a simplified parser - in production, use a proper YAML library
    const lines = yamlText.split('\n').filter(line => 
      line.trim() && !line.trim().startsWith('#')
    );
    
    const config: any = {};
    let currentSection: any = config;
    let sectionStack: any[] = [config];
    let currentIndent = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const indent = line.length - line.trimStart().length;
      
      if (trimmed.includes(':')) {
        const [key, value] = trimmed.split(':').map(s => s.trim());
        
        if (indent > currentIndent) {
          // Nested object
          currentIndent = indent;
        } else if (indent < currentIndent) {
          // Back to parent level
          sectionStack.pop();
          currentSection = sectionStack[sectionStack.length - 1];
          currentIndent = indent;
        }

        if (value) {
          // Has value
          currentSection[key] = isNaN(Number(value)) 
            ? (value === 'true' ? true : value === 'false' ? false : value)
            : Number(value);
        } else {
          // New section
          currentSection[key] = {};
          sectionStack.push(currentSection[key]);
          currentSection = currentSection[key];
        }
      }
    }

    return config;
  }

  function formatConfigAsYaml(config: any, indent = 0): string {
    let yaml = '';
    const indentStr = '  '.repeat(indent);

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        yaml += `${indentStr}${key}:\n`;
        yaml += formatConfigAsYaml(value, indent + 1);
      } else {
        yaml += `${indentStr}${key}: ${value}\n`;
      }
    }

    return yaml;
  }

  const defaultRules = rules.find(r => r.name === 'default');
  
  return (
    <div className="p-6 space-y-6">
      <Card>
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Risk Rules Configuration</h2>
              <p className="text-sm text-muted-foreground mt-1">Define trading parameters and risk limits</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                onClick={handleResetRules}
                disabled={saveRulesMutation.isPending}
                data-testid="button-reset"
              >
                Reset
              </Button>
              <Button
                onClick={handleSaveRules}
                disabled={!isValid || saveRulesMutation.isPending}
                data-testid="button-save"
              >
                {saveRulesMutation.isPending ? 'Saving...' : 'Save Rules'}
              </Button>
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          {/* YAML Editor */}
          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-2 bg-secondary/50 border-b border-border">
              <span className="text-sm font-medium font-mono">rules.yaml</span>
            </div>
            <div className="p-0">
              <Textarea
                value={rulesText || DEFAULT_RULES_YAML}
                onChange={(e) => handleRulesChange(e.target.value)}
                className="min-h-[500px] font-mono text-sm border-0 resize-none focus-visible:ring-0"
                placeholder="Enter YAML configuration..."
                data-testid="textarea-rules"
              />
            </div>
          </div>

          {/* Validation Status */}
          <div className={`mt-4 p-4 border rounded-lg ${
            isValid 
              ? 'bg-green-500/10 border-green-500/20' 
              : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-center space-x-2">
              <CheckCircle className={`h-4 w-4 ${isValid ? 'text-green-400' : 'text-red-400'}`} />
              <span className={`font-medium ${isValid ? 'text-green-400' : 'text-red-400'}`}>
                {isValid ? 'Configuration Valid' : 'Configuration Invalid'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isValid 
                ? `All rules parsed successfully. Last updated: ${defaultRules?.updatedAt ? new Date(defaultRules.updatedAt).toLocaleString() : 'Never'}`
                : 'Please check your YAML syntax and try again.'
              }
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Rule Preview */}
      {defaultRules && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">SPY 0DTE Rules</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delta Range:</span>
                  <span className="font-mono">
                    {defaultRules.config.trading_parameters?.spy_0dte?.delta_range?.min} - {defaultRules.config.trading_parameters?.spy_0dte?.delta_range?.max}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Min Open Interest:</span>
                  <span className="font-mono">{defaultRules.config.trading_parameters?.spy_0dte?.min_open_interest}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Spread Width:</span>
                  <span className="font-mono">${defaultRules.config.trading_parameters?.spy_0dte?.max_spread_width}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Contracts:</span>
                  <span className="font-mono">{defaultRules.config.trading_parameters?.spy_0dte?.max_contracts_per_trade}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Portfolio Limits</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Delta Limit:</span>
                  <span className="font-mono">±{defaultRules.config.risk_limits?.portfolio_delta_limit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margin Utilization:</span>
                  <span className="font-mono">{((defaultRules.config.risk_limits?.max_margin_utilization || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Position Size:</span>
                  <span className="font-mono">${defaultRules.config.risk_limits?.max_position_size?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VIX Threshold:</span>
                  <span className="font-mono">{defaultRules.config.market_conditions?.max_vix_threshold}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
