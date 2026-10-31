import RecipeView from '@/components/RecipeView';

export const metadata = { title: 'Рецепт' };

export default function RecipePage({ params }: { params: { id: string } }) {
  return <RecipeView key={params.id} id={params.id} />;
}
