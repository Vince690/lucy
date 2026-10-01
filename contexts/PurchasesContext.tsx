/**
 * PurchasesContext — état d'abonnement RevenueCat pour toute l'app.
 *
 * Configure le SDK au montage, garde le CustomerInfo à jour via le listener
 * RevenueCat, et surtout synchronise l'identité : Purchases.logIn(ID Supabase)
 * pour que l'abonnement suive le COMPTE (réinstallation, changement d'appareil)
 * et non l'appareil. `isPremium` = entitlement « Lucy Premium » actif.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { useAuth } from '@/contexts/AuthContext';
import {
  configurePurchases,
  hasPremium,
  isPurchasesConfigured,
  isSubscriptionLapsed,
} from '@/utils/purchases';

interface PurchasesContextType {
  customerInfo: CustomerInfo | null;
  isPremium: boolean;
  /**
   * A acheté par le passé, n'a plus rien d'actif. C'est ce drapeau — et non
   * `!isPremium` — qui referme l'accès : voir isSubscriptionLapsed().
   */
  subscriptionLapsed: boolean;
  /**
   * Vrai une fois que RevenueCat a répondu au moins une fois pour la session
   * courante (ou tout de suite quand le SDK n'est pas configuré : web, clé
   * absente). Tant que c'est faux, `customerInfo` absent ne veut rien dire, et la
   * racine ne doit pas en tirer un paywall : quelqu'un qui a épuisé ses échanges
   * offerts et s'est abonné verrait sinon le paywall clignoter à chaque démarrage.
   */
  customerInfoResolved: boolean;
  refreshCustomerInfo: () => Promise<void>;
}

const PurchasesContext = createContext<PurchasesContextType | undefined>(undefined);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [customerInfoResolved, setCustomerInfoResolved] = useState(false);

  useEffect(() => {
    configurePurchases(user?.id);
    if (!isPurchasesConfigured()) {
      setCustomerInfoResolved(true);
      return;
    }

    const listener = (info: CustomerInfo) => setCustomerInfo(info);
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
    // Volontairement montage seul : l'identité est synchronisée par l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronisation de l'identité avec la session Supabase.
  useEffect(() => {
    if (!isPurchasesConfigured()) return;

    // Un nouveau compte repart d'un état inconnu : l'ancien customerInfo ne le
    // concerne pas, et la racine ne doit pas décider sur lui.
    setCustomerInfoResolved(false);

    (async () => {
      try {
        if (user?.id) {
          const { customerInfo: info } = await Purchases.logIn(user.id);
          setCustomerInfo(info);
        } else {
          // logOut échoue si l'utilisateur courant est déjà anonyme.
          const anonymous = await Purchases.isAnonymous();
          if (!anonymous) {
            const info = await Purchases.logOut();
            setCustomerInfo(info);
          }
        }
      } catch (e) {
        console.warn('[purchases] synchronisation identité RevenueCat :', e);
        // Hors ligne, logIn peut échouer alors que le SDK a l'état en cache :
        // on le relit, sinon on décidera sur « inconnu » (voir isPaywallRequired).
        try {
          setCustomerInfo(await Purchases.getCustomerInfo());
        } catch (e2) {
          console.warn('[purchases] getCustomerInfo (repli) :', e2);
        }
      } finally {
        setCustomerInfoResolved(true);
      }
    })();
  }, [user?.id]);

  // Une expiration survenue pendant que l'app dormait ne remonte pas toute
  // seule : on redemande l'état à chaque retour au premier plan.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refreshCustomerInfo();
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshCustomerInfo = async () => {
    if (!isPurchasesConfigured()) return;
    try {
      setCustomerInfo(await Purchases.getCustomerInfo());
    } catch (e) {
      console.warn('[purchases] getCustomerInfo :', e);
    }
  };

  return (
    <PurchasesContext.Provider
      value={{
        customerInfo,
        isPremium: hasPremium(customerInfo),
        subscriptionLapsed: isSubscriptionLapsed(customerInfo),
        customerInfoResolved,
        refreshCustomerInfo,
      }}
    >
      {children}
    </PurchasesContext.Provider>
  );
}

export function usePurchases() {
  const context = useContext(PurchasesContext);
  if (context === undefined) {
    throw new Error('usePurchases must be used within a PurchasesProvider');
  }
  return context;
}
