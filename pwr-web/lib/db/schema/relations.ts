import { relations } from "drizzle-orm/relations";
import { reigns, reign_participants, wrestlers, categories, books, faction_members, factions, territories, issue_cover_subjects, periodical_issues, periodicals, pending_wrestlers, ranking_entries, ranking_lists, wrestler_territory_runs, titles, title_aliases, authors, book_authors } from "./tables";

export const reign_participantsRelations = relations(reign_participants, ({one}) => ({
	reign: one(reigns, {
		fields: [reign_participants.reign_id],
		references: [reigns.id]
	}),
	wrestler: one(wrestlers, {
		fields: [reign_participants.wrestler_id],
		references: [wrestlers.id]
	}),
}));

export const reignsRelations = relations(reigns, ({one, many}) => ({
	reign_participants: many(reign_participants),
	title: one(titles, {
		fields: [reigns.title_id],
		references: [titles.id]
	}),
	wrestler: one(wrestlers, {
		fields: [reigns.wrestler_id],
		references: [wrestlers.id]
	}),
}));

export const wrestlersRelations = relations(wrestlers, ({many}) => ({
	reign_participants: many(reign_participants),
	faction_members: many(faction_members),
	issue_cover_subjects: many(issue_cover_subjects),
	pending_wrestlers: many(pending_wrestlers),
	ranking_entries: many(ranking_entries),
	wrestler_territory_runs: many(wrestler_territory_runs),
	reigns: many(reigns),
}));

export const booksRelations = relations(books, ({one, many}) => ({
	category: one(categories, {
		fields: [books.category_code],
		references: [categories.code]
	}),
	book_authors: many(book_authors),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	books: many(books),
}));

export const faction_membersRelations = relations(faction_members, ({one}) => ({
	wrestler: one(wrestlers, {
		fields: [faction_members.wrestler_id],
		references: [wrestlers.id]
	}),
	faction: one(factions, {
		fields: [faction_members.faction_id],
		references: [factions.id]
	}),
}));

export const factionsRelations = relations(factions, ({one, many}) => ({
	faction_members: many(faction_members),
	territory: one(territories, {
		fields: [factions.primary_territory_id],
		references: [territories.id]
	}),
	issue_cover_subjects: many(issue_cover_subjects),
	ranking_entries: many(ranking_entries),
}));

export const territoriesRelations = relations(territories, ({many}) => ({
	factions: many(factions),
	ranking_lists: many(ranking_lists),
	wrestler_territory_runs: many(wrestler_territory_runs),
	titles: many(titles),
}));

export const issue_cover_subjectsRelations = relations(issue_cover_subjects, ({one}) => ({
	faction: one(factions, {
		fields: [issue_cover_subjects.faction_id],
		references: [factions.id]
	}),
	wrestler: one(wrestlers, {
		fields: [issue_cover_subjects.wrestler_id],
		references: [wrestlers.id]
	}),
	periodical_issue: one(periodical_issues, {
		fields: [issue_cover_subjects.issue_id],
		references: [periodical_issues.id]
	}),
}));

export const periodical_issuesRelations = relations(periodical_issues, ({one, many}) => ({
	issue_cover_subjects: many(issue_cover_subjects),
	periodical: one(periodicals, {
		fields: [periodical_issues.periodical_id],
		references: [periodicals.id]
	}),
	ranking_lists: many(ranking_lists),
}));

export const periodicalsRelations = relations(periodicals, ({many}) => ({
	periodical_issues: many(periodical_issues),
}));

export const pending_wrestlersRelations = relations(pending_wrestlers, ({one, many}) => ({
	wrestler: one(wrestlers, {
		fields: [pending_wrestlers.resolved_wrestler_id],
		references: [wrestlers.id]
	}),
	ranking_entries: many(ranking_entries),
}));

export const ranking_entriesRelations = relations(ranking_entries, ({one}) => ({
	pending_wrestler: one(pending_wrestlers, {
		fields: [ranking_entries.pending_wrestler_id],
		references: [pending_wrestlers.id]
	}),
	faction: one(factions, {
		fields: [ranking_entries.faction_id],
		references: [factions.id]
	}),
	wrestler: one(wrestlers, {
		fields: [ranking_entries.wrestler_id],
		references: [wrestlers.id]
	}),
	ranking_list: one(ranking_lists, {
		fields: [ranking_entries.ranking_list_id],
		references: [ranking_lists.id]
	}),
}));

export const ranking_listsRelations = relations(ranking_lists, ({one, many}) => ({
	ranking_entries: many(ranking_entries),
	territory: one(territories, {
		fields: [ranking_lists.territory_id],
		references: [territories.id]
	}),
	periodical_issue: one(periodical_issues, {
		fields: [ranking_lists.issue_id],
		references: [periodical_issues.id]
	}),
}));

export const wrestler_territory_runsRelations = relations(wrestler_territory_runs, ({one}) => ({
	territory: one(territories, {
		fields: [wrestler_territory_runs.territory_id],
		references: [territories.id]
	}),
	wrestler: one(wrestlers, {
		fields: [wrestler_territory_runs.wrestler_id],
		references: [wrestlers.id]
	}),
}));

export const titlesRelations = relations(titles, ({one, many}) => ({
	reigns: many(reigns),
	territory: one(territories, {
		fields: [titles.territory_id],
		references: [territories.id]
	}),
	title_aliases: many(title_aliases),
}));

export const title_aliasesRelations = relations(title_aliases, ({one}) => ({
	title: one(titles, {
		fields: [title_aliases.title_id],
		references: [titles.id]
	}),
}));

export const book_authorsRelations = relations(book_authors, ({one}) => ({
	author: one(authors, {
		fields: [book_authors.author_id],
		references: [authors.id]
	}),
	book: one(books, {
		fields: [book_authors.book_id],
		references: [books.id]
	}),
}));

export const authorsRelations = relations(authors, ({many}) => ({
	book_authors: many(book_authors),
}));