import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { SpreadConfig, TradeValidation, InsertTrade } from "@shared/schema";

interface TradeValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  spread: SpreadConfig | null;
}

export default function TradeValidationModal({ 
  isOpen, 
  onClose, 
  spread 
}: TradeValidationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validation, setValidation] = useState<TradeValidation | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Validate trade when modal opens with a spread
  useEffect(() => {
    if (isOpen && spread && !validation) {
      validateTrade();
    }
  }, [isOpen, spread]);

  // Reset validation when modal closes
  useEffect(() => {
    if (!isOpen) {
      setValidation(null);
    }
  }, [isOpen]);

  const validateTrade = async () => {
    if (!spread) return;

    setIsValidating(true);
    try {
      const response = await apiRequest('POST', '/api/trades/validate', spread);
      const validationResult = await response.json();
      setValidation(validationResult);
    } catch (error) {
      toast({
        title: "Validation Failed",
        description: "Failed to validate trade. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const submitTradeMutation = useMutation({
    mutationFn: async () => {
      if (!spread) throw new Error("No spread configuration");

      const trade: InsertTrade = {
        symbol: spread.symbol,
        strategy: spread.strategy,
        sellStrike: spread.sellLeg.strike.toString(),
        buyStrike: spread.buyLeg.strike.toString(),
        expiration: new Date(spread.expiration === 'today' ? new Date().toISOString().split('T')[0] : spread.expiration),
        quantity: validation?.allowedContracts || spread.quantity,
        credit: ((spread.sellLeg.premium - spread.buyLeg.premium) * 100 * (validation?.allowedContracts || spread.quantity)).toString(),
        status: 'pending'
      };

      return apiRequest('POST', '/api/trades/submit', trade);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trades'] });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/account'] });
      
      toast({
        title: "Trade Submitted",
        description: "Your trade has been submitted successfully.",
      });
      
      // Close modal after a brief delay to show success
      setTimeout(() => {
        onClose();
      }, 1000);
    },
    onError: (error: any) => {
      toast({
        title: "Trade Submission Failed",
        description: error.message || "Failed to submit trade. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmitTrade = () => {
    submitTradeMutation.mutate();
  };

  const getValidationIcon = (passed: boolean) => {
    return passed ? (
      <CheckCircle className="h-4 w-4 text-green-400" />
    ) : (
      <XCircle className="h-4 w-4 text-red-400" />
    );
  };

  const getValidationBgColor = (passed: boolean) => {
    return passed 
      ? "bg-green-500/10 border-green-500/20" 
      : "bg-red-500/10 border-red-500/20";
  };

  const getValidationTextColor = (passed: boolean) => {
    return passed ? "text-green-400" : "text-red-400";
  };

  if (!spread) return null;

  const allValidationsPassed = validation?.results.every(r => r.passed) ?? false;
  const netCredit = (spread.sellLeg.premium - spread.buyLeg.premium) * 100;
  const allowedContracts = validation?.allowedContracts || 0;
  const totalCredit = netCredit * allowedContracts;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full mx-4 max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Trade Validation</DialogTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              data-testid="button-close-modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Loading State */}
          {isValidating && (
            <div className="text-center py-8">
              <div className="text-muted-foreground">Validating trade...</div>
            </div>
          )}

          {/* Validation Results */}
          {validation && !isValidating && (
            <>
              <div className="space-y-4">
                {validation.results.map((result, index) => (
                  <div 
                    key={index}
                    className={`flex items-center space-x-3 p-3 border rounded-lg ${getValidationBgColor(result.passed)}`}
                  >
                    {getValidationIcon(result.passed)}
                    <div>
                      <div className={`text-sm font-medium ${getValidationTextColor(result.passed)}`}>
                        {result.message}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {result.type === 'margin' && result.details && (
                          `Required: $${result.details.required.toFixed(2)} | Available: $${result.details.available.toFixed(2)}`
                        )}
                        {result.type === 'delta' && result.details && (
                          `Impact: ${result.details.impact.toFixed(2)} | New Total: ${result.details.newTotal.toFixed(2)} | Limit: ±${result.details.limit}`
                        )}
                        {result.type === 'symbol_limit' && result.details && (
                          `${spread.symbol} positions: ${result.details.current}/${result.details.limit}`
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Allowed Contracts */}
              <Card className="bg-primary/10">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-2 text-primary">Allowed Contracts</h4>
                  <div className="text-2xl font-mono font-bold text-primary mb-2" data-testid="text-allowed-contracts">
                    {allowedContracts} contracts
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {allowedContracts > 0 
                      ? "Maximum contracts allowed based on margin requirements and risk limits. This ensures compliance with your portfolio risk parameters."
                      : "No contracts allowed due to validation failures. Please adjust your trade or check your risk limits."
                    }
                  </p>
                </CardContent>
              </Card>

              {/* Trade Summary */}
              <Card className="bg-secondary/30">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-3">Trade Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Strategy:</span>
                      <span className="font-mono">
                        {spread.symbol} {spread.sellLeg.strike}/{spread.buyLeg.strike} {spread.strategy.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Quantity:</span>
                      <span className="font-mono">{allowedContracts} contracts</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Net Credit:</span>
                      <span className="font-mono text-green-400" data-testid="text-total-credit">
                        ${totalCredit.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Margin Required:</span>
                      <span className="font-mono" data-testid="text-margin-required">
                        ${validation.marginRequired.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max Risk:</span>
                      <span className="font-mono text-red-400" data-testid="text-max-risk">
                        ${validation.maxRisk.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Action Buttons */}
        {validation && !isValidating && (
          <div className="flex space-x-3 pt-4 border-t border-border">
            <Button
              className="flex-1"
              onClick={handleSubmitTrade}
              disabled={!allValidationsPassed || allowedContracts === 0 || submitTradeMutation.isPending}
              data-testid="button-submit-trade"
            >
              {submitTradeMutation.isPending ? 'Submitting...' : 'Submit Trade'}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={submitTradeMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
