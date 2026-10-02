import RecipeView from '@/components/RecipeView';

export default function RecipePage({ params }: { params: { id: string } }) {
  return <RecipeView key={params.id} id={params.id} />;
}
