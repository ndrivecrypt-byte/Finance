# BudgetFlow — automatisation sécurisée des échéances

État : préparation technique uniquement. Aucun traitement serveur activé.

## Structure actuelle

La table public.budget_state contient une ligne par user_id (clé primaire).
Le champ data (jsonb) regroupe transactions, schedules, categories et goals.
Le navigateur sauvegarde aujourd'hui un instantané complet par upsert.

## Risque bloquant

Une tâche serveur qui met à jour data pendant qu'un navigateur envoie un ancien
instantané complet peut perdre des transactions ou faire réapparaître des échéances.
La clé primaire user_id n'empêche pas ce conflit.

## Prérequis avant activation

1. Introduire une écriture conditionnelle atomique (version/revision) côté serveur.
2. Faire passer TOUTES les écritures du navigateur par cette méthode ; en cas de
   conflit, recharger et résoudre les modifications, sans écraser silencieusement.
3. Implémenter le traitement quotidien dans une transaction SQL verrouillant
   chaque ligne budget_state (SELECT ... FOR UPDATE), avec mise à jour atomique.
4. Garder le même identifiant d'occurrence que le navigateur :
   echeance-<schedule.id>-<YYYY-MM-DD>, vérifier les deux champs id et
   scheduleOccurrenceId avant insertion.
5. Conserver originalDate comme ancre de récurrence ; gérer fins de mois,
   années bissextiles et dates dépassées.
6. Choisir explicitement le fuseau horaire métier avant de programmer pg_cron.
7. Éviter toute exposition publique de fonction privilégiée : permissions
   minimales et recherche de schéma fixée pour les fonctions SECURITY DEFINER.
8. Tester avec un utilisateur et des données fictives isolés, y compris
   deux navigateurs simultanés et plusieurs exécutions du même jour.
9. Prévoir sauvegarde, restauration et journalisation avant déploiement.

## Déploiement prévu

Phase A : écrire et tester la fonction SQL sans tâche cron.
Phase B : publier le client compatible avec les écritures conditionnelles.
Phase C : vérifier les données et les autorisations.
Phase D : activer la tâche pg_cron, surveiller et tester l'idempotence.

IMPORTANT : ne pas activer pg_cron sur les vraies données tant que le
navigateur continue d'utiliser l'upsert complet non conditionnel.
