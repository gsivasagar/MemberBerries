
export type Bookmark = {
    id: string;
    title: string;
    url: string;
    user_id: string;
    category: string | null;
    created_at?: string;
    ogImage?: string;
    ogTitle?: string;
    ogDescription?: string;
}
